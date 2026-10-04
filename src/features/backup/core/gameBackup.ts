import { z } from 'zod';
import type { RemediationDefinition } from '../../../core/checks/registry';
import { err, ok } from '../../../core/result';
import { createBackup } from './archive';
import type { Ctx, MachineIdentity } from './store';

export const BACKUP_GAME_FILES = 'backup.gameFiles';

export const GameFilesParamsSchema = z.object({
  /** Game module id, e.g. "dcs". */
  game: z.string().min(1),
});
export type GameFilesParams = z.infer<typeof GameFilesParamsSchema>;

const sizeText = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * "Back up now" for the game-updated warning: one backup of everything known about the
 * game (what the user tracks for it and what its module suggests), made before the user
 * marks the new version verified.
 *
 * Its kind is "navigate" on purpose: the backup does not make the warning go away (only
 * "Mark verified" does), so the step is reported by what it did, not by the check
 * passing, and Make ready leaves it to the user (listed under "Needs you" with this
 * button) instead of making a new backup on every run.
 */
export function createGameFilesBackup(
  ctx: Ctx,
  options: () => { identity: MachineIdentity; appVersion: string }
): RemediationDefinition<GameFilesParams> {
  const nameOf = (game: string): string => ctx.games.get(game)?.name ?? game;
  return {
    type: BACKUP_GAME_FILES,
    label: "Back up the game's settings and bindings",
    order: 50,
    kind: 'navigate',
    params: GameFilesParamsSchema,
    describe: (params) => `Back up ${nameOf(params.game)} settings and bindings now`,
    async available(params) {
      return ctx.games.get(params.game)
        ? { ok: true }
        : { ok: false, reason: `This version of RigReady does not know "${params.game}".` };
    },
    async run(params) {
      const made = await createBackup(ctx, { kind: 'game', gameId: params.game }, options());
      if (!made.ok) return made;
      const { backup, skipped } = made.value;
      // Read back by createBackup (describeBackup opens the file it wrote).
      if (backup.damaged)
        return err('backup.write', `The backup is not readable: ${backup.damaged}`);
      const what = `${backup.fileCount} ${backup.fileCount === 1 ? 'file' : 'files'} (${sizeText(backup.totalBytes)})`;
      return ok(
        skipped.length > 0
          ? `Backed up ${what} as "${backup.name}", with ${skipped.length} skipped because they could not be read. It is on the Backups page.`
          : `Backed up ${what} as "${backup.name}". It is on the Backups page.`
      );
    },
  };
}
