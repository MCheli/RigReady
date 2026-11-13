import path from 'node:path';
import {
  IRACING_CONTROLS,
  IRACING_PROFILES,
  controlProfileLines,
} from '../../../core/iracingControls';
import type { ControlProfile, ProfilesInUse } from '../contract';
import type { BindingsContext } from './view';

/**
 * Every control profile iRacing keeps (Documents\iRacing\profiles\controls\<name>), which
 * one it loads for all cars, and which cars have a line of their own in app.ini
 * [ControlProfiles] and which profile each line names. Reads only. The lines are read with
 * the reader the rest of the app uses (src/core/iracingControls.ts).
 */

const GAME = 'iracing';

/** Documents\iRacing, when iRacing has made it. */
export async function iracingFolder(ctx: BindingsContext): Promise<string | undefined> {
  const module = ctx.games.get(GAME);
  if (!module) return undefined;
  const locations = await module.configLocations(ctx);
  return locations.ok ? locations.value.find((l) => l.id === 'documents')?.path : undefined;
}

export const sameProfile = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The [ControlProfiles] lines: the one for all cars, and the first line of each car. */
export function assignments(text: string): {
  global?: string;
  cars: { car: string; profile: string }[];
} {
  const lines = controlProfileLines(text);
  const global = lines.find((l) => l.key.toLowerCase() === 'global')?.value || undefined;
  const cars: { car: string; profile: string }[] = [];
  const seen = new Set<string>(['global']);
  for (const { key, value } of lines) {
    if (seen.has(key.toLowerCase()) || !value) continue;
    seen.add(key.toLowerCase());
    cars.push({ car: key, profile: value });
  }
  return { ...(global ? { global } : {}), cars };
}

/**
 * The profiles on this PC. Undefined on an iRacing without control profiles (no profiles
 * folder) or when the iRacing folder is not there.
 */
export async function profilesInUse(ctx: BindingsContext): Promise<ProfilesInUse | undefined> {
  const folder = await iracingFolder(ctx);
  if (!folder) return undefined;
  const root = path.join(folder, IRACING_PROFILES);
  if (!(await ctx.ports.files.exists(root))) return undefined;
  const entries = await ctx.ports.files.listEntries(root);
  const folders = (entries.ok ? entries.value : [])
    .filter((e) => e.isDirectory)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const ini = path.join(folder, 'app.ini');
  const text = (await ctx.ports.files.exists(ini))
    ? await ctx.ports.files.readText(ini)
    : undefined;
  const { global, cars } = text?.ok ? assignments(text.value) : { cars: [] };

  const profiles: ControlProfile[] = [];
  for (const name of folders) {
    const dir = path.join(root, name);
    profiles.push({
      name,
      folder: dir,
      hasControls: await ctx.ports.files.exists(path.join(dir, IRACING_CONTROLS)),
      forAllCars: global !== undefined && sameProfile(global, name),
      cars: cars
        .filter((c) => sameProfile(c.profile, name))
        .map((c) => c.car)
        .sort((a, b) => a.localeCompare(b)),
    });
  }
  // Lines that name a profile with no folder: iRacing cannot load them either.
  const missing = [
    ...(global && !folders.some((f) => sameProfile(f, global)) ? [{ profile: global }] : []),
    ...cars
      .filter((c) => !folders.some((f) => sameProfile(f, c.profile)))
      .map((c) => ({ car: c.car, profile: c.profile })),
  ];
  return {
    appIni: ini,
    ...(global ? { global } : {}),
    profiles,
    missing,
    ...(text?.ok ? {} : { unread: true }),
  };
}
