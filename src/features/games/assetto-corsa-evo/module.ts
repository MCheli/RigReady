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
 * Assetto Corsa EVO (Steam app 3058630, early access). Detection, launch and version
 * only; the settings folder (Documents\ACE) is tracked when it exists, but its format
 * has not been researched.
 */

const APP_ID = '3058630';
const EXE = 'AssettoCorsaEVO.exe';

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'assetto-corsa-evo', EXE);
}

const userFolder = (ctx: CheckContext): string => path.join(ctx.ports.folders.documents(), 'ACE');

const evo: GameModule = {
  id: 'assetto-corsa-evo',
  name: 'Assetto Corsa EVO',
  processes: [EXE],

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  configLocations: async (ctx) =>
    ok(
      await existingLocations(ctx, [
        { id: 'documents', label: 'Documents\\ACE', path: userFolder(ctx) },
      ])
    ),

  trackedFiles: async (ctx) =>
    ok(
      await existingFiles(ctx, [
        {
          label: 'Settings (Documents\\ACE)',
          path: userFolder(ctx),
          kind: 'folder',
          description: 'Everything in Documents\\ACE: controls, graphics and saved setups.',
        },
      ])
    ),

  installedVersion: (ctx) => steamVersion(ctx, APP_ID),
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: {
    exe: EXE,
    label: 'the Assetto Corsa EVO folder (it contains AssettoCorsaEVO.exe)',
  },
  notes: [
    'Assetto Corsa EVO is in early access: RigReady detects and launches it and backs up its settings folder, but does not read its bindings yet.',
  ],
};

export default evo;
