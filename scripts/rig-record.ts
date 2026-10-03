/**
 * Records this machine into fixtures/rigs/<name>/: provider snapshots as JSON (devices,
 * USB tree, displays, processes, services, audio, DirectInput devices, registry keys,
 * HidHide state) plus a copy of the game and tool configuration files listed in
 * scripts/lib/recordPlan.ts, with the Windows user name removed from paths.
 *
 * Read-only with respect to the machine. NOTES.md in the rig folder is never touched.
 *
 *   npm run rig:record -- <name>
 *   npm run rig:record -- <name> --only=files,registry     refresh some parts, keep the rest
 *
 * Parts: devices, displays, processes, services, audio, input, registry, hidhide, files.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMatcher } from '../src/core/files/glob';
import { nullLogger } from '../src/core/logger';
import type { Ports } from '../src/core/ports';
import { buildUsbTree } from '../src/core/usb';
import { createWindowsPorts } from '../src/platform/windows';
import type { RegistryValue } from '../src/shared/models';
import {
  FILE_SOURCES,
  PLACEHOLDER_FILES,
  REGISTRY_SOURCES,
  SIM_APP_IDS,
  UNINSTALL_ROOTS,
  UNINSTALL_VALUES,
  filterDcsLog,
  filterLibraryFolders,
  redactStreamDeckManifest,
  wantUninstallEntry,
  type RecordRoot,
} from './lib/recordPlan';
import { sanitizeDeep, sanitizeIdentifiers, sanitizeUserPaths } from './lib/sanitize';

/** Files whose text is searched for the user name and for paths to re-point in scenarios. */
const TEXT_EXTENSIONS = new Set([
  '.acf',
  '.cfg',
  '.diff',
  '.ini',
  '.json',
  '.lua',
  '.opt',
  '.txt',
  '.vdf',
  '.xml',
  '.yaml',
]);
const REHOMABLE = /C:(\\\\|\\|\/)(?:Users\1User(?![\w.-])|Program Files|ProgramData)/i;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

interface Recorder {
  outFiles: string;
  user: string;
  count: number;
  bytes: number;
  /** Relative paths (forward slashes) of files that contain paths to re-point. */
  rehome: string[];
  skipped: string[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Writes one recorded file below files/, sanitizing text. `relative` uses the fake-home layout. */
async function put(
  rec: Recorder,
  relative: string,
  content: Buffer,
  transform?: (text: string) => string
): Promise<void> {
  const target = path.join(rec.outFiles, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let data = content;
  if (transform || TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
    // latin1 round-trips every byte, so files keep their encoding and line endings.
    let text = content.toString('latin1');
    if (transform) text = transform(text);
    text = sanitizeIdentifiers(sanitizeUserPaths(text, rec.user));
    if (REHOMABLE.test(text)) rec.rehome.push(relative.replace(/\\/g, '/'));
    data = Buffer.from(text, 'latin1');
  }
  await fs.writeFile(target, data);
  rec.count++;
  rec.bytes += data.length;
}

async function walk(dir: string, prefix = ''): Promise<{ full: string; relative: string }[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { full: string; relative: string }[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(full, relative)));
    else if (entry.isFile()) found.push({ full, relative });
  }
  return found;
}

async function recordRegistry(
  ports: Ports,
  user: string
): Promise<Record<string, Record<string, RegistryValue>>> {
  const out: Record<string, Record<string, RegistryValue>> = {};
  const dump = async (
    hive: 'HKCU' | 'HKLM',
    key: string,
    depth: number,
    only?: string[]
  ): Promise<void> => {
    const values = await ports.registry.listValues(hive, key);
    const children = await ports.registry.listKeys(hive, key);
    if (!values.ok || !children.ok) return;
    const kept = Object.fromEntries(
      Object.entries(values.value).filter(
        ([name]) => !only || only.some((o) => o.toLowerCase() === name.toLowerCase())
      )
    );
    // A key is recorded when it has values to show or exists as a leaf.
    if (Object.keys(kept).length > 0 || children.value.length === 0) {
      out[`${hive}\\${key}`] = kept;
    }
    if (depth <= 0) return;
    for (const child of children.value) await dump(hive, `${key}\\${child}`, depth - 1, only);
  };
  for (const source of REGISTRY_SOURCES) {
    const present = await ports.registry.listKeys(source.hive, source.key);
    const values = await ports.registry.listValues(source.hive, source.key);
    if (present.ok && values.ok && present.value.length + Object.keys(values.value).length > 0) {
      await dump(source.hive, source.key, source.depth, source.values);
    }
  }
  for (const root of UNINSTALL_ROOTS) {
    const names = await ports.registry.listKeys(root.hive, root.key);
    if (!names.ok) continue;
    for (const name of names.value) {
      const key = `${root.key}\\${name}`;
      const display = await ports.registry.getValue(root.hive, key, 'DisplayName');
      const displayName = display.ok && display.value?.type === 'string' ? display.value.value : '';
      if (!wantUninstallEntry(name, displayName)) continue;
      await dump(root.hive, key, 0, UNINSTALL_VALUES);
    }
  }
  // Steam's per-app state for the sims only (not the whole library).
  for (const appId of Object.keys(SIM_APP_IDS)) {
    await dump('HKCU', `Software\\Valve\\Steam\\Apps\\${appId}`, 0, [
      'Installed',
      'Name',
      'Running',
      'Updating',
    ]);
  }
  for (const [key, values] of Object.entries(out)) {
    if (Object.keys(values).length === 0 && !/Calibration|DirectInput/i.test(key)) delete out[key];
  }
  return sanitizeDeep(out, user);
}

async function recordHidHide(ports: Ports, user: string): Promise<unknown> {
  const cli = path.join(
    ports.folders.programFiles(),
    'Nefarius Software Solutions',
    'HidHide',
    'x64',
    'HidHideCLI.exe'
  );
  if (!(await exists(cli))) return { installed: false };
  // --cancel last: the CLI must not save anything.
  const state = await ports.shell.run(cli, [
    '--cloak-state',
    '--inv-state',
    '--dev-list',
    '--app-list',
    '--cancel',
  ]);
  const gaming = await ports.shell.run(cli, ['--dev-gaming', '--cancel']);
  if (!state.ok || !gaming.ok) return { installed: true, cliPath: cli };
  const lines = state.value.stdout.split(/\r?\n/).map((l) => l.trim());
  const quoted = (flag: string): string[] =>
    lines
      .filter((l) => l.startsWith(`${flag} `))
      .map((l) => l.slice(flag.length + 1).replace(/^"|"$/g, ''));
  let devices: unknown = [];
  try {
    devices = JSON.parse(gaming.value.stdout);
  } catch {
    devices = [];
  }
  return sanitizeDeep(
    {
      installed: true,
      cliPath: cli,
      cloak: lines.includes('--cloak-on'),
      inverse: lines.includes('--inv-on'),
      hidden: quoted('--dev-hide'),
      apps: quoted('--app-reg'),
      gaming: devices,
    },
    user
  );
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : undefined;
  const want = (part: string): boolean => !only || only.has(part);
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error('Usage: npm run rig:record -- <name>   (lower-case letters, digits, dashes)');
    process.exit(2);
  }
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const outDir = path.join(projectRoot, 'fixtures', 'rigs', name);
  const user = os.userInfo().username;
  const ports = createWindowsPorts({ log: nullLogger, projectRoot });

  const unwrap = <T>(
    label: string,
    result: { ok: true; value: T } | { ok: false; error: { message: string; detail?: string } }
  ): T => {
    if (!result.ok)
      throw new Error(`${label}: ${result.error.message} ${result.error.detail ?? ''}`);
    return result.value;
  };

  const devices = unwrap('devices', await ports.devices.list());
  const displays = unwrap('displays', await ports.displays.read());
  const processes = unwrap('processes', await ports.processes.list());
  const services = unwrap('services', await ports.services.list());
  const audio = unwrap('audio', await ports.audio.read());
  const libraries = unwrap('steam libraries', await ports.folders.steamLibraries());

  const notes: string[] = [];
  let input: unknown[] = [];
  const started = await ports.input.start();
  if (started.ok) {
    input = started.value;
    await ports.input.stop();
  } else {
    notes.push(
      `DirectInput devices not recorded: ${started.error.message} ${started.error.detail ?? ''}`.trim()
    );
  }

  await fs.mkdir(outDir, { recursive: true });
  const write = async (file: string, value: unknown): Promise<void> => {
    await fs.writeFile(
      path.join(outDir, file),
      JSON.stringify(sanitizeDeep(value, user), null, 2) + '\n'
    );
  };
  if (want('devices')) {
    await write('devices.json', devices);
    await write('usb-tree.json', buildUsbTree(devices));
  }
  if (want('displays')) await write('displays.json', displays);
  if (want('processes')) await write('processes.json', processes);
  if (want('services')) await write('services.json', services);
  if (want('audio')) await write('audio.json', audio);
  if (want('input') && started.ok) await write('input.json', input);
  const registry = await recordRegistry(ports, user);
  if (want('registry')) await write('registry.json', registry);
  if (want('hidhide')) await write('hidhide.json', await recordHidHide(ports, user));
  if (!want('files')) {
    console.log(`Recorded ${[...(only ?? [])].join(', ')} of ${name} -> ${outDir}`);
    return;
  }

  // ---- files ----
  const rec: Recorder = {
    outFiles: path.join(outDir, 'files'),
    user,
    count: 0,
    bytes: 0,
    rehome: [],
    skipped: [],
  };
  await fs.rm(rec.outFiles, { recursive: true, force: true });

  // Where each root lives on this PC, and where it goes in the fake user folder.
  // The registry gives the Steam path in lower case; ask the file system for the real casing.
  const steam = libraries[0] ? await fs.realpath(libraries[0]) : undefined;
  const roots: Record<RecordRoot, { real: string | undefined; fake: string }> = {
    savedGames: { real: ports.folders.savedGames(), fake: 'Saved Games' },
    documents: { real: ports.folders.documents(), fake: 'Documents' },
    appData: { real: ports.folders.appData(), fake: 'AppData\\Roaming' },
    localAppData: { real: ports.folders.localAppData(), fake: 'AppData\\Local' },
    programFiles: { real: ports.folders.programFiles(), fake: 'Program Files' },
    programFilesX86: { real: ports.folders.programFilesX86(), fake: 'Program Files (x86)' },
    steamLibrary: {
      real: steam,
      fake: steam ? path.relative(path.parse(steam).root, steam) : 'Program Files (x86)\\Steam',
    },
  };
  if (libraries.length > 1) {
    notes.push(`Only the first Steam library was recorded (${libraries.length} exist).`);
  }

  for (const source of FILE_SOURCES) {
    const root = roots[source.root];
    if (!root.real) continue;
    const dir = path.join(root.real, source.dir);
    const matches = createMatcher(source.include, source.exclude);
    for (const file of await walk(dir)) {
      if (!matches(file.relative)) continue;
      const stat = await fs.stat(file.full);
      if (stat.size > (source.maxBytes ?? DEFAULT_MAX_BYTES)) {
        rec.skipped.push(`${file.full} (${stat.size} bytes)`);
        continue;
      }
      await put(rec, path.join(root.fake, source.dir, file.relative), await fs.readFile(file.full));
    }
  }

  // Empty folders that matter (git does not keep them): mark them with an empty .keep file.
  for (const dir of ['DCS\\Kneeboard', 'DCS\\Config\\MonitorSetup']) {
    const real = path.join(ports.folders.savedGames(), dir);
    if ((await exists(real)) && (await fs.readdir(real)).length === 0) {
      await put(rec, path.join('Saved Games', dir, '.keep'), Buffer.alloc(0));
    }
  }

  // dcs.log: only the lines that identify the controllers.
  const dcsLog = path.join(ports.folders.savedGames(), 'DCS', 'Logs', 'dcs.log');
  if (await exists(dcsLog)) {
    await put(rec, 'Saved Games\\DCS\\Logs\\dcs.log', await fs.readFile(dcsLog), filterDcsLog);
  }

  // Steam: the library list and the manifests of the sims.
  if (steam) {
    const steamapps = path.join(steam, 'steamapps');
    const libraryFile = path.join(steamapps, 'libraryfolders.vdf');
    if (await exists(libraryFile)) {
      await put(
        rec,
        path.join(roots.steamLibrary.fake, 'steamapps', 'libraryfolders.vdf'),
        await fs.readFile(libraryFile),
        filterLibraryFolders
      );
    }
    for (const appId of Object.keys(SIM_APP_IDS)) {
      const manifest = path.join(steamapps, `appmanifest_${appId}.acf`);
      if (!(await exists(manifest))) continue;
      await put(
        rec,
        path.join(roots.steamLibrary.fake, 'steamapps', `appmanifest_${appId}.acf`),
        await fs.readFile(manifest)
      );
    }
  }

  // Stream Deck: two profiles' manifests (settings emptied) and the plugin manifests. No images.
  const streamDeck = path.join(ports.folders.appData(), 'Elgato', 'StreamDeck');
  const profilesDir = path.join(streamDeck, 'ProfilesV3');
  if (await exists(profilesDir)) {
    const profiles = (await fs.readdir(profilesDir)).filter((n) => n.endsWith('.sdProfile')).sort();
    for (const profile of profiles.slice(0, 2)) {
      const manifests = (await walk(path.join(profilesDir, profile)))
        .filter((f) => path.basename(f.relative) === 'manifest.json')
        .sort((a, b) => a.relative.localeCompare(b.relative))
        // The profile's own manifest plus its first three pages.
        .filter(
          (f, index, all) =>
            f.relative === 'manifest.json' ||
            all.slice(0, index).filter((x) => x.relative !== 'manifest.json').length < 3
        );
      for (const manifest of manifests) {
        await put(
          rec,
          path.join('AppData\\Roaming\\Elgato\\StreamDeck\\ProfilesV3', profile, manifest.relative),
          await fs.readFile(manifest.full),
          redactStreamDeckManifest
        );
      }
    }
    notes.push(
      `Stream Deck: ${Math.min(2, profiles.length)} of ${profiles.length} profiles recorded (manifests only, action settings emptied).`
    );
  }
  const pluginsDir = path.join(streamDeck, 'Plugins');
  if (await exists(pluginsDir)) {
    for (const plugin of await fs.readdir(pluginsDir)) {
      const manifest = path.join(pluginsDir, plugin, 'manifest.json');
      if (!(await exists(manifest))) continue;
      await put(
        rec,
        path.join('AppData\\Roaming\\Elgato\\StreamDeck\\Plugins', plugin, 'manifest.json'),
        await fs.readFile(manifest)
      );
    }
  }

  // Programs, as empty files: listed ones that exist, plus running helper apps.
  const placeholders = new Set<string>();
  for (const placeholder of PLACEHOLDER_FILES) {
    const root = roots[placeholder.root];
    if (root.real && (await exists(path.join(root.real, placeholder.path)))) {
      placeholders.add(path.join(root.fake, placeholder.path));
    }
  }
  const helper = /TrackIR|SimAppPro|StreamDeck|Fanatec|HidHide|Tacview|iRacing|steam\.exe$|DCS/i;
  for (const p of processes) {
    if (!p.path || !helper.test(p.path)) continue;
    for (const root of Object.values(roots)) {
      if (!root.real) continue;
      const relative = path.relative(root.real, p.path);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      placeholders.add(path.join(root.fake, relative));
      break;
    }
  }
  for (const placeholder of placeholders) {
    if (!(await exists(path.join(rec.outFiles, placeholder)))) {
      await put(rec, placeholder, Buffer.alloc(0));
    }
  }

  await fs.writeFile(
    path.join(outDir, 'rehome.json'),
    JSON.stringify([...new Set(rec.rehome)].sort(), null, 2) + '\n'
  );
  for (const skipped of rec.skipped) notes.push(`Skipped as too large: ${skipped}`);

  let previous: { parts?: Record<string, string>; counts?: Record<string, number> } = {};
  try {
    previous = JSON.parse(await fs.readFile(path.join(outDir, 'meta.json'), 'utf8'));
  } catch {
    previous = {};
  }
  const now = new Date().toISOString();
  const parts: Record<string, string> = { ...(previous.parts ?? {}) };
  for (const part of [
    'devices',
    'displays',
    'processes',
    'services',
    'audio',
    'input',
    'registry',
    'hidhide',
    'files',
  ]) {
    if (want(part)) parts[part] = now;
  }
  await write('meta.json', {
    name,
    /** When each part was last recorded. */
    parts,
    recordedAt: now,
    os: `${os.type()} ${os.release()}`,
    // A part that was not re-recorded keeps the count it had.
    counts: {
      ...(previous.counts ?? {}),
      ...(want('devices') ? { devices: devices.length } : {}),
      ...(want('displays') ? { displays: displays.displays.length } : {}),
      ...(want('processes') ? { processes: processes.length } : {}),
      ...(want('services') ? { services: services.length } : {}),
      ...(want('audio') ? { audioEndpoints: audio.devices.length } : {}),
      ...(want('input') ? { inputDevices: input.length } : {}),
      ...(want('registry') ? { registryKeys: Object.keys(registry).length } : {}),
      files: rec.count,
      fileBytes: rec.bytes,
      placeholders: placeholders.size,
    },
    notes: notes.map((n) => sanitizeUserPaths(n, user)),
  });

  console.log(`Recorded ${name} -> ${outDir}`);
  console.log(
    `  ${devices.length} USB devices, ${displays.displays.length} displays, ${processes.length} processes, ` +
      `${services.length} services, ${audio.devices.length} audio endpoints, ${input.length} DirectInput devices, ` +
      `${Object.keys(registry).length} registry keys`
  );
  console.log(
    `  ${rec.count} files (${(rec.bytes / (1024 * 1024)).toFixed(1)} MB), ${placeholders.size} of them empty program placeholders`
  );
  for (const note of notes) console.log(`  note: ${note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
