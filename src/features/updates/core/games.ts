import path from 'node:path';
import type { MainContext } from '../../../core/feature';
import { ok, type Result } from '../../../core/result';

const baseName = (exe: string): string => path.win32.basename(exe.replace(/\//g, '\\'));

/**
 * The image names that mean a game is running: what every game module declares, and the
 * program each setup launches directly. A setup that hands the game to Steam is covered
 * by its game module; steam.exe itself is never "the game".
 */
export async function gameProcessNames(
  ctx: Pick<MainContext, 'games' | 'profiles'>
): Promise<string[]> {
  const names = new Map<string, string>();
  const add = (name: string): void => {
    if (name && name.toLowerCase() !== 'steam.exe') names.set(name.toLowerCase(), name);
  };
  for (const module of ctx.games.all()) for (const name of module.processes ?? []) add(name);
  const profiles = await ctx.profiles.list();
  if (profiles.ok) {
    for (const profile of profiles.value) {
      if (profile.launch && profile.steamAppId === undefined) add(baseName(profile.launch.exe));
    }
  }
  return [...names.values()];
}

/**
 * The game that is running right now, if any. This is wider than "a game RigReady
 * launched": a game the user started by hand counts too, because replacing RigReady
 * under a running session is never worth it. A process list that cannot be read is an
 * error, and the caller treats that as "do not install".
 */
export async function runningGame(
  ctx: Pick<MainContext, 'games' | 'profiles' | 'ports'>
): Promise<Result<string | undefined>> {
  const names = await gameProcessNames(ctx);
  const list = await ctx.ports.processes.list();
  if (!list.ok) return list;
  const running = new Set(list.value.map((p) => p.name.toLowerCase()));
  return ok(names.find((name) => running.has(name.toLowerCase())));
}
