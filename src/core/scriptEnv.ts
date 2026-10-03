import type { CheckContext } from './checks/registry';
import type { GameRegistry } from './games';

/**
 * What a script or a launch action is told about the setup it runs for, as environment
 * variables. Values from a setup reach a program only this way or as separate arguments;
 * they are never placed into command text.
 *
 * RIGREADY_GAME_PATH is the install folder of the setup's game (the one the setup names,
 * else the first found) and RIGREADY_USER_DATA its per-user folder; both are empty when
 * the setup has no known game or the game is not installed.
 */
export async function scriptEnvironment(
  ctx: CheckContext,
  games: GameRegistry
): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    RIGREADY_PROFILE_NAME: ctx.profile?.name ?? '',
    RIGREADY_PROFILE_ID: ctx.profile?.id ?? '',
    RIGREADY_GAME: ctx.profile?.game ?? '',
    RIGREADY_GAME_PATH: '',
    RIGREADY_USER_DATA: '',
    RIGREADY_HOME: ctx.ports.folders.dataRoot(),
  };
  const module = ctx.profile?.game ? games.get(ctx.profile.game) : undefined;
  if (!module) return env;
  try {
    const installs = await module.detect(ctx);
    const wanted = ctx.profile?.install?.toLowerCase();
    const install = installs.ok
      ? wanted
        ? installs.value.find((i) => i.installDir.toLowerCase() === wanted)
        : installs.value[0]
      : undefined;
    if (install) env['RIGREADY_GAME_PATH'] = install.installDir;
    if (install?.userDir) env['RIGREADY_USER_DATA'] = install.userDir;
    else if (!wanted) {
      const locations = await module.configLocations(ctx);
      if (locations.ok && locations.value[0]) env['RIGREADY_USER_DATA'] = locations.value[0].path;
    }
  } catch (e) {
    ctx.log.error(`script environment for ${module.id} threw`, e);
  }
  return env;
}
