import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { simpleGame } from '../core/simpleGame';

/**
 * Assetto Corsa Competizione (Steam app 805550, Unreal Engine). Settings are JSON files in
 * Documents\Assetto Corsa Competizione\Config (controls.json holds the bindings), shared
 * control presets in Customs\Controls, car setups in Setups. The game program is
 * AC2\Binaries\Win64\AC2-Win64-Shipping.exe. Sources: docs/research/game-modules-2026-11.md
 * section 5.
 */

const APP_ID = '805550';
const EXE = path.join('AC2', 'Binaries', 'Win64', 'AC2-Win64-Shipping.exe');

const userFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'Assetto Corsa Competizione');

const { module, extras } = simpleGame({
  id: 'acc',
  name: 'Assetto Corsa Competizione',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  steamNeedsExe: true,
  processes: ['AC2-Win64-Shipping.exe'],
  closeWhy:
    'Assetto Corsa Competizione writes its settings and controls while it runs, which could undo the restore.',

  async locations(ctx) {
    return [
      {
        id: 'config',
        label: 'Documents\\Assetto Corsa Competizione\\Config',
        path: path.join(userFolder(ctx), 'Config'),
      },
    ];
  },

  async tracked(ctx) {
    const dir = userFolder(ctx);
    const config = path.join(dir, 'Config');
    return [
      {
        label: 'Assetto Corsa Competizione settings and bindings',
        path: config,
        kind: 'folder',
        description:
          'The whole Config folder: bindings and force feedback (controls.json), menu, graphics and audio settings.',
      },
      {
        label: 'Bindings and force feedback (controls.json)',
        path: path.join(config, 'controls.json'),
      },
      { label: 'Menu settings (menuSettings.json)', path: path.join(config, 'menuSettings.json') },
      {
        label: 'Control presets (Customs\\Controls)',
        path: path.join(dir, 'Customs', 'Controls'),
        kind: 'folder',
      },
      { label: 'Car setups (Setups)', path: path.join(dir, 'Setups'), kind: 'folder' },
    ];
  },

  manualLabel:
    'the Assetto Corsa Competizione folder (it contains AC2\\Binaries\\Win64\\AC2-Win64-Shipping.exe)',
  notes: [
    'RigReady backs up controls.json as a file; it does not list what is bound.',
    'A major game update can reset the menu settings: keep a backup from before it.',
  ],
});

export { extras };
export default module;
