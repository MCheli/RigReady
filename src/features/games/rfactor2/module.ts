import path from 'node:path';
import type { GameInstall, TrackedFileSuggestion } from '../../../core/games';
import { simpleGame } from '../core/simpleGame';

/**
 * rFactor 2 (Steam app 365960). Like Le Mans Ultimate, which uses the same engine, it keeps
 * its settings inside the game folder: UserData\Config.ini, the player files in
 * UserData\player (player.JSON, the active bindings in Controller.JSON) and saved controller
 * profiles in UserData\Controller. Sources: docs/research/game-modules-2026-11.md section 6.
 */

const APP_ID = '365960';
const EXE = path.join('Bin64', 'rFactor2.exe');

const userData = (install: GameInstall): string => path.join(install.installDir, 'UserData');

const { module, extras } = simpleGame({
  id: 'rfactor2',
  name: 'rFactor 2',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  processes: ['rFactor2.exe'],
  closeWhy:
    'rFactor 2 saves its player and controller files when it exits, which would undo the restore.',

  async locations(_ctx, installs) {
    return installs.flatMap((install) => [
      {
        id: 'player',
        label: 'UserData\\player (bindings and settings)',
        path: path.join(userData(install), 'player'),
      },
      { id: 'userdata', label: 'UserData', path: userData(install) },
    ]);
  },

  async tracked(_ctx, installs) {
    const suggestions: TrackedFileSuggestion[] = [];
    for (const install of installs) {
      const dir = userData(install);
      const player = path.join(dir, 'player');
      suggestions.push(
        {
          label: 'rFactor 2 settings and bindings',
          path: dir,
          kind: 'folder',
          include: ['Config*.ini', 'player/*', 'player/Settings/**', 'Controller/**'],
          description:
            'The player files (bindings, force feedback, game settings), car setups, saved controller profiles and the display settings. Logs, replays and screenshots are left out.',
        },
        {
          label: 'Bindings and force feedback (Controller.JSON)',
          path: path.join(player, 'Controller.JSON'),
        },
        { label: 'Game settings (player.JSON)', path: path.join(player, 'player.JSON') },
        { label: 'Display settings (Config.ini)', path: path.join(dir, 'Config.ini') },
        { label: 'Controller profiles', path: path.join(dir, 'Controller'), kind: 'folder' },
        { label: 'Car setups (per track)', path: path.join(player, 'Settings'), kind: 'folder' }
      );
    }
    return suggestions;
  },

  manualLabel: 'the rFactor 2 folder (it contains Bin64\\rFactor2.exe)',
  notes: [
    'rFactor 2 keeps its settings inside the game folder (UserData), so uninstalling the game can delete them: keep a backup.',
    'RigReady backs up Controller.JSON as a file; it does not list what is bound.',
  ],
});

export { extras };
export default module;
