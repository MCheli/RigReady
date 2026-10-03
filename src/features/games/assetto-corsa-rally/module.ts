import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameModule } from '../../../core/games';
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
 * Assetto Corsa Rally (Steam app 3917090, an Unreal Engine game). Settings are in
 * %LOCALAPPDATA%\acr\Saved: Config\Windows\GameUserSettings.ini and, for input,
 * SaveGames\EnhancedInputUserSettings.sav (binary).
 */

const APP_ID = '3917090';
const EXE = path.join('acr', 'Binaries', 'Win64', 'acr.exe');

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'assetto-corsa-rally', EXE);
}

const saved = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.localAppData(), 'acr', 'Saved');

const rally: GameModule = {
  id: 'assetto-corsa-rally',
  name: 'Assetto Corsa Rally',

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  configLocations: async (ctx) =>
    ok(
      await existingLocations(ctx, [
        { id: 'saved', label: 'AppData\\Local\\acr\\Saved', path: saved(ctx) },
      ])
    ),

  trackedFiles: async (ctx) =>
    ok(
      await existingFiles(ctx, [
        {
          label: 'Graphics (GameUserSettings.ini)',
          path: path.join(saved(ctx), 'Config', 'Windows', 'GameUserSettings.ini'),
        },
        {
          label: 'Bindings (EnhancedInputUserSettings.sav)',
          path: path.join(saved(ctx), 'SaveGames', 'EnhancedInputUserSettings.sav'),
        },
      ])
    ),

  installedVersion: (ctx) => steamVersion(ctx, APP_ID),
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: {
    exe: EXE,
    label: 'the Assetto Corsa Rally folder (it contains acr\\Binaries\\Win64\\acr.exe)',
  },
  processes: ['acr.exe', 'acr-Win64-Shipping.exe'],
  notes: [
    'Bindings are saved in a binary Unreal Engine file: RigReady backs it up as a whole but cannot list what is bound.',
  ],
};

export default rally;
