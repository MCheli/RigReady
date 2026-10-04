import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameRegistry } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import { MONITOR_SETUP_NAME } from './screens';

/** The DCS files this feature works with, resolved through the DCS game module. */
export interface DcsPaths {
  install?: GameInstall;
  installs: GameInstall[];
  /** Saved Games\DCS (or DCS.<variant>) of the first install. */
  userDir: string;
  options: string;
  exportLua: string;
  userMonitorSetups: string;
  /** RigReady's own MonitorSetup file. */
  rigReadyLua: string;
}

export async function dcsPaths(ctx: CheckContext, games: GameRegistry): Promise<Result<DcsPaths>> {
  const dcs = games.get('dcs');
  if (!dcs) return err('dcs.module', 'This version of RigReady has no DCS World support.');
  const installs = await dcs.detect(ctx);
  if (!installs.ok) return installs;
  // A setup that names its install gets that one or an error, never another install's files.
  const chosen = ctx.profile?.game === 'dcs' ? ctx.profile.install : undefined;
  const install = chosen
    ? installs.value.find(
        (i) => path.resolve(i.installDir).toLowerCase() === path.resolve(chosen).toLowerCase()
      )
    : installs.value[0];
  if (chosen && !install) {
    return err(
      'dcs.installMissing',
      'DCS install not found',
      `This setup uses the DCS install at ${chosen}, which is gone.`
    );
  }
  let userDir = install?.userDir;
  if (!userDir) {
    const locations = await dcs.configLocations(ctx);
    userDir = locations.ok ? locations.value[0]?.path : undefined;
  }
  if (!userDir) {
    return err(
      'dcs.notFound',
      'DCS World was not found: no install in any Steam library or standalone, and no DCS folder in Saved Games.'
    );
  }
  const monitorSetups = path.join(userDir, 'Config', 'MonitorSetup');
  return ok({
    ...(install ? { install } : {}),
    installs: installs.value,
    userDir,
    options: path.join(userDir, 'Config', 'options.lua'),
    exportLua: path.join(userDir, 'Scripts', 'Export.lua'),
    userMonitorSetups: monitorSetups,
    rigReadyLua: path.join(monitorSetups, `${MONITOR_SETUP_NAME}.lua`),
  });
}

/** DCS rewrites options.lua (and reads Export.lua and MonitorSetup) on its own schedule. */
export async function dcsRunning(ctx: CheckContext): Promise<boolean> {
  const processes = await ctx.ports.processes.list();
  return processes.ok && processes.value.some((p) => /^dcs(_mt)?\.exe$/i.test(p.name));
}

export const DCS_RUNNING_MESSAGE =
  'DCS is running. Close DCS first: it rewrites options.lua when it exits and reads these files only when it starts.';

export async function refuseWhileRunning(ctx: CheckContext): Promise<Result<void>> {
  return (await dcsRunning(ctx)) ? err('dcs.running', DCS_RUNNING_MESSAGE) : ok(undefined);
}
