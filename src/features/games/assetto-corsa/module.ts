import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameModule, TrackedFileSuggestion } from '../../../core/games';
import { ok } from '../../../core/result';
import {
  existingFiles,
  existingLocations,
  manualInstall,
  steamInstall,
  steamVersion,
  type GameModuleExtras,
} from '../core/helpers';

/**
 * Assetto Corsa (Steam app 244210). Settings are INI files in Documents\Assetto Corsa\cfg;
 * controls.ini holds the bindings and the controllers by DirectInput GUID.
 */

const APP_ID = '244210';
const EXE = 'AssettoCorsa.exe';

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID, EXE);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'assetto-corsa', EXE);
}

export const cfgFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'Assetto Corsa', 'cfg');
const contentManager = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.localAppData(), 'AcTools Content Manager');

const assettoCorsa: GameModule = {
  id: 'assetto-corsa',
  name: 'Assetto Corsa',

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  async configLocations(ctx) {
    return ok(
      await existingLocations(ctx, [
        { id: 'cfg', label: 'Documents\\Assetto Corsa\\cfg', path: cfgFolder(ctx) },
        { id: 'content-manager', label: 'Content Manager settings', path: contentManager(ctx) },
      ])
    );
  },

  async trackedFiles(ctx) {
    const dir = cfgFolder(ctx);
    const suggestions: TrackedFileSuggestion[] = [
      { label: 'Bindings and force feedback (controls.ini)', path: path.join(dir, 'controls.ini') },
      { label: 'Graphics (video.ini)', path: path.join(dir, 'video.ini') },
      { label: 'Gameplay (gameplay.ini)', path: path.join(dir, 'gameplay.ini') },
      { label: 'Assists (assists.ini)', path: path.join(dir, 'assists.ini') },
      { label: 'Audio (audio.ini)', path: path.join(dir, 'audio.ini') },
      { label: 'Control presets', path: path.join(dir, 'controllers', 'savedsetups') },
    ];
    return ok(await existingFiles(ctx, suggestions));
  },

  installedVersion: (ctx) => steamVersion(ctx, APP_ID),

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    if (await ctx.ports.files.exists(cfgFolder(ctx))) {
      variables['AC_USER'] = path.dirname(cfgFolder(ctx));
    }
    const install = await findInstall(ctx);
    if (install) variables['AC_INSTALL'] = install.installDir;
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: { exe: EXE, label: 'the assettocorsa folder (it contains AssettoCorsa.exe)' },
  processes: [EXE, 'acs.exe', 'Content Manager.exe'],
  notes: [
    'Bindings refer to controllers by their Windows instance id; after a USB port change Assetto Corsa may ask you to bind the wheel again.',
  ],
};

export default assettoCorsa;
