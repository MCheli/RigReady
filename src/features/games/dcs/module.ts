import path from 'node:path';
import type { GameModule, TrackedFileSuggestion } from '../../../core/games';
import { err, ok } from '../../../core/result';
import type { GameModuleExtras } from '../core/helpers';
import { DCS_EXE, detectInstalls, installVersion, sameDir, userLocations } from './detect';

/**
 * DCS World: installs (every Steam library and standalone), the Saved Games folder of
 * each, versions and path variables. Monitor setup, Export.lua and options.lua are the
 * dcs-setup feature; bindings are dcs-bindings. Both find DCS through this module.
 */
const dcs: GameModule = {
  id: 'dcs',
  name: 'DCS World',

  processes: ['DCS.exe'],

  detect: (ctx) => detectInstalls(ctx),

  async configLocations(ctx) {
    const installs = await detectInstalls(ctx);
    return userLocations(ctx, installs.ok ? installs.value : []);
  },

  async trackedFiles(ctx) {
    const locations = await this.configLocations(ctx);
    if (!locations.ok) return locations;
    const user = locations.value[0];
    if (!user) return ok([]);
    const files: TrackedFileSuggestion[] = [
      { label: 'DCS options', path: path.join(user.path, 'Config', 'options.lua') },
      { label: 'DCS input bindings', path: path.join(user.path, 'Config', 'Input') },
      { label: 'DCS monitor setups', path: path.join(user.path, 'Config', 'MonitorSetup') },
      { label: 'DCS Export.lua', path: path.join(user.path, 'Scripts', 'Export.lua') },
    ];
    return ok(files);
  },

  installedVersion: (ctx, install) => installVersion(ctx, install),

  /**
   * {DCS_INSTALL} is the first install found (Steam first); {DCS_USER} is the Saved Games
   * folder that install writes to, or the first DCS folder in Saved Games when it has none yet.
   */
  async pathVariables(ctx, installDir) {
    const variables: Record<string, string> = {};
    const installs = await detectInstalls(ctx);
    if (installDir) {
      // The install a setup chose: its folders, or nothing. Never another install's.
      const chosen = (installs.ok ? installs.value : []).find((i) =>
        sameDir(i.installDir, installDir)
      );
      if (!chosen) return err('dcs.installMissing', 'DCS install not found', installDir);
      variables['DCS_INSTALL'] = chosen.installDir;
      if (chosen.userDir) variables['DCS_USER'] = chosen.userDir;
      return ok(variables);
    }
    const first = installs.ok ? installs.value[0] : undefined;
    if (first) variables['DCS_INSTALL'] = first.installDir;
    const locations = await userLocations(ctx, installs.ok ? installs.value : []);
    if (locations.ok && locations.value[0]) variables['DCS_USER'] = locations.value[0].path;
    return ok(variables);
  },
};

export default dcs;

export const extras: GameModuleExtras = {
  kind: 'flight',
  // A standalone install on another drive whose registry entry is gone can be pointed at.
  manualFolder: {
    exe: DCS_EXE,
    label: 'the DCS World folder (the one that contains the "bin" folder)',
  },
};
