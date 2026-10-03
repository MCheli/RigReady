/**
 * Records this machine into fixtures/rigs/<name>/ as JSON: devices, USB tree, displays,
 * processes, audio, DirectInput devices, plus a copy of the DCS input files with the
 * Windows user name removed from paths. Read-only with respect to the machine.
 *
 *   npm run rig:record -- <name>
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nullLogger } from '../src/core/logger';
import { buildUsbTree } from '../src/core/usb';
import { createWindowsPorts } from '../src/platform/windows';
import { sanitizeDeep, sanitizeUserPaths } from './lib/sanitize';

const TEXT_EXTENSIONS = new Set(['.lua', '.json', '.cfg', '.txt', '.ini', '.xml', '.yaml']);

async function copySanitized(from: string, to: string, user: string): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += await copySanitized(source, target, user);
    } else if (entry.isFile()) {
      await fs.mkdir(to, { recursive: true });
      if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        await fs.writeFile(target, sanitizeUserPaths(await fs.readFile(source, 'utf8'), user));
      } else {
        await fs.copyFile(source, target);
      }
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  const name = process.argv[2];
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
  const audio = unwrap('audio', await ports.audio.read());

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
  await write('devices.json', devices);
  await write('usb-tree.json', buildUsbTree(devices));
  await write('displays.json', displays);
  await write('processes.json', processes);
  await write('audio.json', audio);
  await write('input.json', input);

  let dcsFiles = 0;
  const dcsInput = path.join(ports.folders.savedGames(), 'DCS', 'Config', 'Input');
  try {
    await fs.access(dcsInput);
    const target = path.join(outDir, 'files', 'Saved Games', 'DCS', 'Config', 'Input');
    await fs.rm(target, { recursive: true, force: true });
    dcsFiles = await copySanitized(dcsInput, target, user);
  } catch {
    notes.push('No DCS input folder found; game files not recorded.');
  }

  await write('meta.json', {
    name,
    recordedAt: new Date().toISOString(),
    os: `${os.type()} ${os.release()}`,
    counts: {
      devices: devices.length,
      displays: displays.displays.length,
      processes: processes.length,
      audioEndpoints: audio.devices.length,
      inputDevices: input.length,
      dcsFiles,
    },
    notes,
  });

  console.log(`Recorded ${name} -> ${outDir}`);
  console.log(
    `  ${devices.length} USB devices, ${displays.displays.length} displays, ${processes.length} processes, ` +
      `${audio.devices.length} audio endpoints, ${input.length} DirectInput devices, ${dcsFiles} DCS files`
  );
  for (const note of notes) console.log(`  note: ${note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
