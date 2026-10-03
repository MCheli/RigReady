import path from 'node:path';
import type { FileStore, KnownFolders, Registry } from './ports';
import { err, ok, type Result } from './result';
import { parseVdf, steamLibraryPaths } from './vdf';

/** Where Steam is installed, from the registry. Undefined when Steam is absent. */
export async function steamRoot(registry: Registry): Promise<string | undefined> {
  const user = await registry.getValue('HKCU', 'Software\\Valve\\Steam', 'SteamPath');
  if (user.ok && user.value?.type === 'string' && user.value.value) {
    return path.resolve(user.value.value);
  }
  const machine = await registry.getValue(
    'HKLM',
    'SOFTWARE\\WOW6432Node\\Valve\\Steam',
    'InstallPath'
  );
  if (machine.ok && machine.value?.type === 'string' && machine.value.value) {
    return path.resolve(machine.value.value);
  }
  return undefined;
}

/** Every Steam library folder: the install folder plus those in libraryfolders.vdf. */
export async function findSteamLibraries(
  registry: Registry,
  readText: (file: string) => Promise<string>
): Promise<Result<string[]>> {
  const root = await steamRoot(registry);
  if (!root) return ok([]);
  const found = new Map<string, string>([[root.toLowerCase(), root]]);
  try {
    const text = await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    for (const library of steamLibraryPaths(text)) {
      const resolved = path.resolve(library);
      // The library file spells folders the way they are on disk; the registry value is lower-cased.
      found.set(resolved.toLowerCase(), resolved);
    }
  } catch {
    // No library file: the install folder itself is the only library.
  }
  return ok([...found.values()]);
}

export interface SteamApp {
  appId: string;
  name: string;
  /** The library folder the manifest was found in. */
  library: string;
  /** Absolute install folder: <library>\steamapps\common\<installdir>. */
  installDir: string;
  buildId: string;
  /** The build Steam wants to move to, when it differs from buildId. */
  targetBuildId?: string;
  /** When Steam last updated the game (ISO), when recorded. */
  lastUpdated?: string;
  /** Raw StateFlags bitmask: 4 = fully installed, value 2 set = update required. */
  stateFlags: number;
  /** True when Steam has an update queued: the game may refuse to start until it is applied. */
  updatePending: boolean;
}

/** Parses the text of steamapps/appmanifest_<appid>.acf. */
export function parseAppManifest(text: string, library: string): Result<SteamApp> {
  let state;
  try {
    state = parseVdf(text)['AppState'];
  } catch (e) {
    return err('steam.manifest', 'The Steam app manifest is not readable.', String(e));
  }
  if (!state || typeof state === 'string') {
    return err('steam.manifest', 'The Steam app manifest has no AppState.');
  }
  const field = (key: string): string => {
    const value = state[key];
    return typeof value === 'string' ? value : '';
  };
  const appId = field('appid');
  const installdir = field('installdir');
  if (!appId || !installdir) {
    return err('steam.manifest', 'The Steam app manifest has no appid or installdir.');
  }
  const stateFlags = Number.parseInt(field('StateFlags'), 10) || 0;
  const buildId = field('buildid');
  const target = field('TargetBuildID');
  const differentTarget = target !== '' && target !== '0' && target !== buildId;
  const updated = Number.parseInt(field('LastUpdated'), 10);
  const app: SteamApp = {
    appId,
    name: field('name'),
    library,
    installDir: path.join(library, 'steamapps', 'common', installdir),
    buildId,
    stateFlags,
    updatePending: (stateFlags & 2) !== 0 || differentTarget,
  };
  if (differentTarget) app.targetBuildId = target;
  if (Number.isFinite(updated) && updated > 0) {
    app.lastUpdated = new Date(updated * 1000).toISOString();
  }
  return ok(app);
}

type SteamPorts = { files: FileStore; folders: KnownFolders };

/** One installed Steam game by app id, searched in every library. Undefined when not installed. */
export async function readSteamApp(
  ports: SteamPorts,
  appId: string | number
): Promise<Result<SteamApp | undefined>> {
  const libraries = await ports.folders.steamLibraries();
  if (!libraries.ok) return libraries;
  for (const library of libraries.value) {
    const manifest = path.join(library, 'steamapps', `appmanifest_${appId}.acf`);
    if (!(await ports.files.exists(manifest))) continue;
    const text = await ports.files.readText(manifest);
    if (!text.ok) return text;
    return parseAppManifest(text.value, library);
  }
  return ok(undefined);
}

/** Every Steam game installed in any library. Unreadable manifests are skipped. */
export async function listSteamApps(ports: SteamPorts): Promise<Result<SteamApp[]>> {
  const libraries = await ports.folders.steamLibraries();
  if (!libraries.ok) return libraries;
  const apps: SteamApp[] = [];
  for (const library of libraries.value) {
    const names = await ports.files.list(path.join(library, 'steamapps'));
    if (!names.ok) continue;
    for (const name of names.value) {
      if (!/^appmanifest_\d+\.acf$/i.test(name)) continue;
      const text = await ports.files.readText(path.join(library, 'steamapps', name));
      if (!text.ok) continue;
      const app = parseAppManifest(text.value, library);
      if (app.ok) apps.push(app.value);
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return ok(apps);
}
