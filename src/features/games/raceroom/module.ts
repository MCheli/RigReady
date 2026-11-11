import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { simpleGame } from '../core/simpleGame';

/**
 * RaceRoom Racing Experience (Steam app 211500, free to play; the cars and tracks are
 * further Steam apps). Its settings are in Documents\My Games\SimBin\RaceRoom Racing
 * Experience\UserData. Sources: docs/research/game-modules-2026-11.md section 11.
 */

const APP_ID = '211500';
const EXE = path.join('Game', 'x64', 'RRRE64.exe');

const userData = (ctx: CheckContext): string =>
  path.join(
    ctx.ports.folders.documents(),
    'My Games',
    'SimBin',
    'RaceRoom Racing Experience',
    'UserData'
  );

const { module, extras } = simpleGame({
  id: 'raceroom',
  name: 'RaceRoom Racing Experience',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  processes: ['RRRE64.exe'],
  closeWhy: 'RaceRoom writes its settings while it runs, which could undo the restore.',

  async locations(ctx) {
    return [
      {
        id: 'userdata',
        label: 'Documents\\My Games\\SimBin\\RaceRoom Racing Experience\\UserData',
        path: userData(ctx),
      },
    ];
  },

  async tracked(ctx) {
    return [
      {
        label: 'RaceRoom settings',
        path: userData(ctx),
        kind: 'folder',
        description: 'The UserData folder, where RaceRoom keeps its settings on this PC.',
      },
    ];
  },

  manualLabel: 'the RaceRoom Racing Experience folder (it contains Game\\x64\\RRRE64.exe)',
  notes: [
    'RaceRoom is started through Steam.',
    'RigReady backs up the UserData folder as a whole; it does not list what is bound.',
  ],
});

export { extras };
export default module;
