import path from 'node:path';
import type { ConfigLocation, GameInstall, GameModule } from '../../../core/games';
import { ok } from '../../../core/result';

/**
 * DCS World. Detection and config locations only; bindings, monitor setup and the
 * rest are added by the DCS feature work (see docs/research/dcs.md).
 */
const dcs: GameModule = {
  id: 'dcs',
  name: 'DCS World',

  async detect(ctx) {
    const installs: GameInstall[] = [];
    const libraries = await ctx.ports.folders.steamLibraries();
    if (!libraries.ok) return libraries;
    for (const library of libraries.value) {
      const installDir = path.join(library, 'steamapps', 'common', 'DCSWorld');
      const exe = path.join(installDir, 'bin', 'DCS.exe');
      if (await ctx.ports.files.exists(exe)) {
        installs.push({
          source: 'steam',
          installDir,
          launch: { exe, args: [], cwd: path.join(installDir, 'bin') },
        });
      }
    }
    return ok(installs);
  },

  async configLocations(ctx) {
    const locations: ConfigLocation[] = [];
    // Standalone stable and the old open beta use different Saved Games folders.
    for (const [id, folder] of [
      ['dcs', 'DCS'],
      ['dcs-openbeta', 'DCS.openbeta'],
    ] as const) {
      const dir = path.join(ctx.ports.folders.savedGames(), folder);
      if (await ctx.ports.files.exists(path.join(dir, 'Config'))) {
        locations.push({ id, label: `Saved Games\\${folder}`, path: dir });
      }
    }
    return ok(locations);
  },

  /** {DCS_USER} is the Saved Games folder DCS writes to; {DCS_INSTALL} the first install found. */
  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    const locations = await this.configLocations(ctx);
    if (locations.ok && locations.value[0]) variables['DCS_USER'] = locations.value[0].path;
    const installs = await this.detect(ctx);
    if (installs.ok && installs.value[0]) variables['DCS_INSTALL'] = installs.value[0].installDir;
    return ok(variables);
  },
};

export default dcs;
