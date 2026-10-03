import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GameRegistry } from '../src/core/games';
import { nullLogger } from '../src/core/logger';
import type { FakePorts } from '../src/platform/fake';
import { DcsBindings } from '../src/features/dcs-bindings/core/bindings';

/**
 * Helpers for this feature's tests: a DcsBindings on a test rig's fake ports, and the
 * old-device-id binding files recorded from the owner's backup.
 */

export const HORNET = 'FA-18C_hornet';
export const HUEY = 'UH-1H';

/** Files the binding tests need from the recorded rig. */
export const BINDING_FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];

export const fixtureData = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'scenarios',
  'data',
  'dcs-bindings'
);

/** A DcsBindings that finds DCS without the game module (the fallback path). */
export function bindingsFor(rig: { ports: FakePorts }): DcsBindings {
  return new DcsBindings({ ports: rig.ports, log: nullLogger, games: new GameRegistry() });
}

export function inputDir(home: string): string {
  return path.join(home, 'Saved Games', 'DCS', 'Config', 'Input');
}

export function joystickDir(home: string, aircraft = HORNET): string {
  return path.join(inputDir(home), aircraft, 'joystick');
}

/** The full path of a device's diff file in the fake home, by the start of its name. */
export async function diffFile(home: string, prefix: string, aircraft = HORNET): Promise<string> {
  const dir = joystickDir(home, aircraft);
  const name = (await fs.readdir(dir)).find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`No diff file starting with "${prefix}" in ${dir}`);
  return path.join(dir, name);
}

/**
 * Replaces an aircraft's binding files in the fake home with the ones from the owner's
 * older backup, whose device ids (GUIDs) no longer match any attached device.
 */
export async function useOldBindings(home: string, aircraft: string): Promise<string[]> {
  const from = path.join(fixtureData, 'old-ids', aircraft, 'joystick');
  const to = joystickDir(home, aircraft);
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(to, { recursive: true });
  const names = await fs.readdir(from);
  for (const name of names) await fs.copyFile(path.join(from, name), path.join(to, name));
  return names;
}
