import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type {
  ConfigLocation,
  GameInstall,
  GameModule,
  TrackedFileSuggestion,
} from '../../../core/games';
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
 * only; the settings folder is tracked when it exists, but its files are binary and
 * their format has not been researched.
 *
 * Where the settings live: builds before 0.5.2 used Documents\ACE; the 0.5.2 patch
 * notes (505 Games support, "Assetto Corsa EVO 0.5.2 Patch Notes") move it to
 * Saved Games\ACE, and that is where the owner's rig keeps input_devices.
 * inputdeviceconfiguration, input_settings.inputsettings, ProfileData and SavedCars.
 * Both are looked for, newest first; a PC that still has the old folder gets both.
 */

const APP_ID = '3058630';
const EXE = 'AssettoCorsaEVO.exe';

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'assetto-corsa-evo', EXE);
}

/** Newest location first. */
const settingsFolders = (ctx: CheckContext): ConfigLocation[] => [
  {
    id: 'saved-games',
    label: 'Saved Games\\ACE',
    path: path.join(ctx.ports.folders.savedGames(), 'ACE'),
  },
  {
    id: 'documents',
    label: 'Documents\\ACE',
    path: path.join(ctx.ports.folders.documents(), 'ACE'),
  },
];

const evo: GameModule = {
  id: 'assetto-corsa-evo',
  name: 'Assetto Corsa EVO',
  processes: [EXE],

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  configLocations: async (ctx) => ok(await existingLocations(ctx, settingsFolders(ctx))),

  trackedFiles: async (ctx) =>
    ok(
      await existingFiles(
        ctx,
        settingsFolders(ctx).map((f): TrackedFileSuggestion => ({
          label: `Settings (${f.label})`,
          path: f.path,
          kind: 'folder',
          description:
            f.id === 'documents'
              ? `Everything in ${f.label}, where builds before 0.5.2 kept controls, graphics and saved setups.`
              : `Everything in ${f.label}: controls, graphics and saved setups.`,
        }))
      )
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
