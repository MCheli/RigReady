import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { TrackedFileSuggestion } from '../../../core/games';
import { filesIn, simpleGame } from '../core/simpleGame';

/**
 * Automobilista 2 (Steam app 1066890, program AMS2AVX.exe). Everything it keeps for the
 * player is in Documents\Automobilista 2; the controller settings are
 * savegame\<profile>\automobilista 2\profiles\default.controllersettings* next to the
 * driver profile. Sources: docs/research/game-modules-2026-11.md section 7.
 */

const APP_ID = '1066890';
const EXE = 'AMS2AVX.exe';

const userFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'Automobilista 2');

/** The profiles folder of every player profile in savegame\<id>\automobilista 2\profiles. */
async function profileFolders(ctx: CheckContext): Promise<string[]> {
  const savegame = path.join(userFolder(ctx), 'savegame');
  const ids = await ctx.ports.files.list(savegame);
  const found: string[] = [];
  for (const id of ids.ok ? ids.value : []) {
    const dir = path.join(savegame, id, 'automobilista 2', 'profiles');
    if (await ctx.ports.files.exists(dir)) found.push(dir);
  }
  return found;
}

const { module, extras } = simpleGame({
  id: 'ams2',
  name: 'Automobilista 2',
  kind: 'racing',
  steamAppId: APP_ID,
  exe: EXE,
  steamNeedsExe: true,
  processes: [EXE],
  closeWhy:
    'Automobilista 2 writes its settings and controller files while it runs, which could undo the restore.',

  async locations(ctx) {
    return [{ id: 'documents', label: 'Documents\\Automobilista 2', path: userFolder(ctx) }];
  },

  async tracked(ctx) {
    const suggestions: TrackedFileSuggestion[] = [
      {
        label: 'Automobilista 2 settings and controls',
        path: userFolder(ctx),
        kind: 'folder',
        description:
          'Everything the game keeps in Documents\\Automobilista 2: graphics and game settings, the controller settings and the driver profile.',
      },
    ];
    for (const dir of await profileFolders(ctx)) {
      suggestions.push(
        ...(await filesIn(
          ctx,
          dir,
          /controllersettings/i,
          (name) => `Controller settings (${name})`
        ))
      );
    }
    return suggestions;
  },

  manualLabel: 'the Automobilista 2 folder (it contains AMS2AVX.exe)',
  notes: ['RigReady backs up the controller settings as a file; it does not list what is bound.'],
});

export { extras };
export default module;
