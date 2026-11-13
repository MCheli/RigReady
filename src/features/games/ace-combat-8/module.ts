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
 * ACE COMBAT 8: WINGS OF THEVE (Steam app 2288340, October 2026). An Unreal Engine game
 * that reads a gamepad, the two licensed flight sticks, and few others; players with other
 * sticks feed it a virtual Xbox 360 controller (Configure > Virtual controller). Its
 * settings are under %LOCALAPPDATA%\BANDAI NAMCO Entertainment\ACE COMBAT 8\Saved, as the
 * community reports it; the program is Game\Binaries\Win64\AceCombat8.exe behind an Easy
 * Anti-Cheat launcher. Neither path has been seen on a PC that RigReady ran on yet: both
 * are only used when they exist. See docs/research/gamepad-emulation.md.
 */

const APP_ID = '2288340';
const EXE = 'AceCombat8.exe';
const EXE_PATH = path.join('Game', 'Binaries', 'Win64', EXE);

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'ace-combat-8', EXE_PATH);
}

const userFolder = (ctx: CheckContext): string =>
  path.join(
    ctx.ports.folders.localAppData(),
    'BANDAI NAMCO Entertainment',
    'ACE COMBAT 8',
    'Saved'
  );

const aceCombat8: GameModule = {
  id: 'ace-combat-8',
  // Written the way people write it. Steam and the game's own folders use capitals.
  name: 'Ace Combat 8: Wings of Theve',
  kind: 'flight',
  // Flown on a gamepad: a stick, throttle and pedals reach it through a virtual controller.
  // It reads no head tracker, no panel or MFD software, and has no radio or voice chat.
  playedWith: {
    gear: ['stick', 'yoke', 'throttle', 'pedals'],
    helpers: false,
    microphone: false,
    gamepad: true,
  },
  processes: [EXE],
  closeBeforeRestore: { why: 'The game writes its settings while it runs and when it exits.' },
  pathVariableLabels: {
    AC8_INSTALL: 'Ace Combat 8 install',
    AC8_USER: 'Ace Combat 8 settings and saves',
  },

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  async configLocations(ctx) {
    const saved = userFolder(ctx);
    return ok(
      await existingLocations(ctx, [
        { id: 'config', label: 'Settings', path: path.join(saved, 'Config', 'Windows') },
        { id: 'saves', label: 'Saves', path: path.join(saved, 'SaveGames') },
      ])
    );
  },

  async trackedFiles(ctx) {
    const saved = userFolder(ctx);
    return ok(
      await existingFiles(ctx, [
        {
          label: 'Ace Combat 8 settings and saves',
          path: saved,
          kind: 'folder',
          include: ['Config/**', 'SaveGames/**'],
          exclude: ['Logs/**', 'Crashes/**'],
          description:
            'Graphics, sound and control settings (Config\\Windows) and the save games. Logs and crash reports are left out.',
        },
        {
          label: 'Graphics and display (GameUserSettings.ini)',
          path: path.join(saved, 'Config', 'Windows', 'GameUserSettings.ini'),
        },
        {
          label: 'Controls (Input.ini)',
          path: path.join(saved, 'Config', 'Windows', 'Input.ini'),
        },
      ])
    );
  },

  async installedVersion(ctx) {
    return steamVersion(ctx, APP_ID);
  },

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    const install = await findInstall(ctx);
    if (install) variables['AC8_INSTALL'] = install.installDir;
    const saved = userFolder(ctx);
    if (await ctx.ports.files.exists(saved)) variables['AC8_USER'] = saved;
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'flight',
  manualFolder: {
    exe: EXE_PATH,
    label: 'the ACE COMBAT 8 folder (it contains Game\\Binaries\\Win64\\AceCombat8.exe)',
  },
  notes: [
    'The game reads a gamepad and two licensed flight sticks. For any other stick, wheel or HOTAS, give it a virtual Xbox 360 controller: Configure > Virtual controller has a starting profile for it.',
    'The game uses Easy Anti-Cheat for online play. Nothing is known of it refusing a virtual controller, but try one offline first.',
  ],
};

export default aceCombat8;
