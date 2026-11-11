import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, TrackedFileSuggestion } from '../../../core/games';
import { filesIn, simpleGame, standaloneAt } from '../core/simpleGame';

/**
 * X-Plane 11 and 12 (Laminar Research). Each version is sold on Steam (12: app 2014780,
 * 11: app 269950) and as a standalone download whose installer records every install
 * folder, one per line, in %LOCALAPPDATA%\x-plane_install_<version>.txt. Preferences,
 * the joystick and key settings (*.prf) and the saved control profiles live in
 * <install>\Output\preferences. Sources: docs/research/game-modules-2026-11.md section 2.
 */

const EXE = 'X-Plane.exe';

/** Install folders recorded by the standalone installer, in the order it wrote them. */
async function recordedInstalls(ctx: CheckContext, version: 11 | 12): Promise<GameInstall[]> {
  const file = path.join(ctx.ports.folders.localAppData(), `x-plane_install_${version}.txt`);
  if (!(await ctx.ports.files.exists(file))) return [];
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return [];
  const installs: GameInstall[] = [];
  for (const line of text.value.split(/\r?\n/)) {
    const dir = line.trim().replace(/[\\/]+$/, '');
    if (!dir || !path.isAbsolute(dir)) continue;
    const install = await standaloneAt(ctx, path.resolve(dir), EXE);
    if (install) installs.push(install);
  }
  return installs;
}

const preferences = (install: GameInstall): string =>
  path.join(install.installDir, 'Output', 'preferences');

export function xPlane(version: 11 | 12, steamAppId: string) {
  return simpleGame({
    id: `x-plane-${version}`,
    name: `X-Plane ${version}`,
    kind: 'flight',
    steamAppId,
    exe: EXE,
    steamNeedsExe: true,
    otherInstalls: (ctx) => recordedInstalls(ctx, version),
    processes: [EXE],
    closeWhy:
      'X-Plane writes its preferences and control settings while it runs, which could undo the restore.',

    async locations(_ctx, installs) {
      return installs.map((install, index) => ({
        id: `preferences-${index + 1}`,
        label: 'Output\\preferences (preferences and control profiles)',
        path: preferences(install),
      }));
    },

    async tracked(ctx, installs) {
      const suggestions: TrackedFileSuggestion[] = [];
      for (const install of installs) {
        const dir = preferences(install);
        suggestions.push(
          {
            label: `X-Plane ${version} preferences and controls`,
            path: dir,
            kind: 'folder',
            include: ['*.prf', 'control profiles/**'],
            description:
              'The preference files (*.prf), among them the joystick, key and graphics settings, and every saved control profile. Nothing else in the folder is included.',
          },
          {
            label: 'Control profiles',
            path: path.join(dir, 'control profiles'),
            kind: 'folder',
          },
          ...(await filesIn(ctx, dir, /\.prf$/i, (name) => `Preferences (${name})`))
        );
      }
      return suggestions;
    },

    manualLabel: `the X-Plane ${version} folder (it contains X-Plane.exe)`,
    notes: [
      `X-Plane keeps its preferences and control profiles inside the X-Plane ${version} folder (Output\\preferences), so deleting that folder deletes them: keep a backup.`,
      'RigReady backs up the joystick and key settings as files; it does not list what is bound.',
      'A standalone install is started directly; a Steam install through Steam.',
    ],
  });
}
