import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { simpleGame } from '../core/simpleGame';

/**
 * EA SPORTS WRC (Steam app 1849250, Unreal Engine; program WRC\Binaries\Win64\WRC.exe).
 * Settings are INI files in %LOCALAPPDATA%\WRC\Saved\Config\WindowsNoEditor
 * (GameUserSettings.ini, EgoInput.ini, Input.ini); the telemetry (UDP) settings are
 * Documents\My Games\WRC\telemetry\config.json. Saves are Steam Cloud files and are left out.
 * Sources: docs/research/game-modules-2026-11.md section 8.
 */

const APP_ID = '1849250';
const EXE = path.join('WRC', 'Binaries', 'Win64', 'WRC.exe');

const configFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.localAppData(), 'WRC', 'Saved', 'Config', 'WindowsNoEditor');
const telemetryFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'My Games', 'WRC', 'telemetry');

const { module, extras } = simpleGame({
  id: 'ea-wrc',
  name: 'EA SPORTS WRC',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  steamNeedsExe: true,
  processes: ['WRC.exe'],
  closeWhy: 'EA SPORTS WRC writes its settings while it runs, which could undo the restore.',

  async locations(ctx) {
    return [
      { id: 'config', label: 'AppData\\Local\\WRC\\Saved\\Config', path: configFolder(ctx) },
      { id: 'telemetry', label: 'Documents\\My Games\\WRC\\telemetry', path: telemetryFolder(ctx) },
    ];
  },

  async tracked(ctx) {
    const dir = configFolder(ctx);
    return [
      {
        label: 'EA SPORTS WRC settings',
        path: dir,
        kind: 'folder',
        include: ['*.ini'],
        description:
          'Every settings file of the game (graphics, input options, hardware): the INI files only.',
      },
      {
        label: 'Graphics and game settings (GameUserSettings.ini)',
        path: path.join(dir, 'GameUserSettings.ini'),
      },
      { label: 'Input options (EgoInput.ini)', path: path.join(dir, 'EgoInput.ini') },
      { label: 'Input (Input.ini)', path: path.join(dir, 'Input.ini') },
      {
        label: 'Telemetry for dashboards and motion (config.json)',
        path: path.join(telemetryFolder(ctx), 'config.json'),
      },
    ];
  },

  manualLabel: 'the EA SPORTS WRC folder (it contains WRC\\Binaries\\Win64\\WRC.exe)',
  notes: [
    'EA SPORTS WRC is started through Steam so its anti-cheat works.',
    'Where the game keeps your controller bindings is not known to RigReady, so they are not in its backup; the settings files are.',
  ],
});

export { extras };
export default module;
