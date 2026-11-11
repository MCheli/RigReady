import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { simpleGame } from '../core/simpleGame';

/**
 * EA SPORTS F1 (Codemasters). Each year is its own Steam app (F1 25: 3059520, F1 24:
 * 2488620). The PC hardware settings are Documents\My Games\F1 <yy>\hardwaresettings
 * (hardware_settings_config.xml), the file EA support asks players to delete when a wheel
 * misbehaves; saves are Steam Cloud files and are left out.
 * Sources: docs/research/game-modules-2026-11.md section 9.
 */
export function f1(year: 24 | 25, steamAppId: string) {
  const exe = `F1_${year}.exe`;
  const settings = (ctx: CheckContext): string =>
    path.join(ctx.ports.folders.documents(), 'My Games', `F1 ${year}`, 'hardwaresettings');
  return simpleGame({
    id: `f1-${year}`,
    name: `F1 ${year}`,
    kind: 'racing',
    steamAppId,
    exe,
    processes: [exe],
    closeWhy: `F1 ${year} writes its hardware settings while it runs, which could undo the restore.`,

    async locations(ctx) {
      return [
        {
          id: 'hardwaresettings',
          label: `Documents\\My Games\\F1 ${year}\\hardwaresettings`,
          path: settings(ctx),
        },
      ];
    },

    async tracked(ctx) {
      return [
        {
          label: `F1 ${year} hardware settings`,
          path: settings(ctx),
          kind: 'folder',
          description: 'The hardwaresettings folder: graphics and the other PC hardware settings.',
        },
        {
          label: 'Hardware settings (hardware_settings_config.xml)',
          path: path.join(settings(ctx), 'hardware_settings_config.xml'),
        },
      ];
    },

    manualLabel: `the F1 ${year} folder (it contains ${exe})`,
    notes: [
      `F1 ${year} is started through Steam so its anti-cheat works.`,
      'Where the game keeps your controller bindings is not known to RigReady, so they may not be in its backup; the hardware settings are.',
      'If a wheel stops working, EA support suggests deleting the hardwaresettings files: back them up first, and restore them from Backups if that did not help.',
    ],
  });
}
