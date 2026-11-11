import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, TrackedFileSuggestion } from '../../../core/games';
import { simpleGame, storeInstall } from '../core/simpleGame';

/**
 * DiRT Rally 2.0 (Codemasters). Steam app 690790, or the Microsoft Store package
 * CodemastersSoftwareCompan.DiRTRally2.0Windows_4cfye3zbe1gaw. Hardware settings are in
 * Documents\My Games\DiRT Rally 2.0\hardwaresettings; the binding maps for each wheel and
 * any custom one are XML files in the game folder, input\actionmaps, and the controllers the
 * game recognises are listed in input\devices\device_defines.xml.
 * Sources: docs/research/game-modules-2026-11.md section 10.
 */

const APP_ID = '690790';
const EXE = 'dirtrally2.exe';
const STORE_PACKAGE = 'CodemastersSoftwareCompan.DiRTRally2.0Windows_4cfye3zbe1gaw';

const settings = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'My Games', 'DiRT Rally 2.0', 'hardwaresettings');
const input = (install: GameInstall): string => path.join(install.installDir, 'input');

const { module, extras } = simpleGame({
  id: 'dirt-rally-2',
  name: 'DiRT Rally 2.0',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  otherInstalls: (ctx) => storeInstall(ctx, STORE_PACKAGE),
  processes: [EXE],
  closeWhy:
    'DiRT Rally 2.0 writes its hardware settings while it runs, which could undo the restore.',

  async locations(ctx, installs) {
    return [
      {
        id: 'hardwaresettings',
        label: 'Documents\\My Games\\DiRT Rally 2.0\\hardwaresettings',
        path: settings(ctx),
      },
      ...installs
        .filter((i) => i.source !== 'store')
        .map((install) => ({
          id: 'actionmaps',
          label: 'input\\actionmaps (binding maps)',
          path: path.join(input(install), 'actionmaps'),
        })),
    ];
  },

  async tracked(ctx, installs) {
    const suggestions: TrackedFileSuggestion[] = [
      {
        label: 'DiRT Rally 2.0 hardware settings',
        path: settings(ctx),
        kind: 'folder',
        description: 'The hardwaresettings folder: graphics and the other PC hardware settings.',
      },
      {
        label: 'Hardware settings (hardware_settings_config.xml)',
        path: path.join(settings(ctx), 'hardware_settings_config.xml'),
      },
    ];
    for (const install of installs.filter((i) => i.source !== 'store')) {
      suggestions.push(
        {
          label: 'Binding maps (input\\actionmaps)',
          path: path.join(input(install), 'actionmaps'),
          kind: 'folder',
          description:
            'One XML file per wheel or controller, your edited or custom maps among them. A game update or a file check in Steam can put the shipped ones back.',
        },
        {
          label: 'Recognised controllers (device_defines.xml)',
          path: path.join(input(install), 'devices', 'device_defines.xml'),
        }
      );
    }
    return suggestions;
  },

  manualLabel: 'the DiRT Rally 2.0 folder (it contains dirtrally2.exe)',
  notes: [
    'The binding maps live in the game folder (input\\actionmaps); verifying the game files in Steam can replace an edited map with the shipped one, so keep a backup.',
    'The Microsoft Store edition is started from the Start menu; RigReady cannot launch it directly.',
  ],
});

export { extras };
export default module;
