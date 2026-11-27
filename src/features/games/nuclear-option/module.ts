import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { simpleGame } from '../core/simpleGame';

/**
 * Nuclear Option (Steam app 2168680, program NuclearOption.exe, a Unity game by Shockfront
 * Studios). It keeps its settings and its bindings in the Windows registry
 * (HKEY_CURRENT_USER\Software\Shockfront\NuclearOption), not in files, so there is no file
 * to offer for backup; its folder in AppData\LocalLow holds the logs and the mission being
 * edited. Sources: docs/research/nuclear-option.md.
 */

const APP_ID = '2168680';
const EXE = 'NuclearOption.exe';

/** Unity's persistent data folder: AppData\LocalLow\<company>\<product>. */
const dataFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.home(), 'AppData', 'LocalLow', 'Shockfront', 'NuclearOption');

const { module, extras } = simpleGame({
  id: 'nuclear-option',
  name: 'Nuclear Option',
  kind: 'flight',
  steamAppId: APP_ID,
  exe: EXE,
  steamNeedsExe: true,
  processes: [EXE],
  closeWhy: 'Nuclear Option writes its files while it runs, which could undo the restore.',

  async locations(ctx) {
    return [
      {
        id: 'data',
        label: 'AppData\\LocalLow\\Shockfront\\NuclearOption (logs)',
        path: dataFolder(ctx),
      },
    ];
  },

  // Nothing: the settings and bindings are registry values, and the files are logs.
  async tracked() {
    return [];
  },

  noFiles: 'Nothing: Nuclear Option has no settings file. Its settings are in the registry.',
  manualLabel: 'the Nuclear Option folder (it contains NuclearOption.exe)',
  notes: [
    'Nuclear Option keeps its settings and bindings in the Windows registry, not in files. RigReady shows the bindings on the Bindings page. A full backup keeps the registry values to read back; a restore cannot put them back.',
  ],
});

export { extras };
export default module;
