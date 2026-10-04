import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore, KnownFolders } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import {
  AircraftProgressSchema,
  EMPTY_PROGRESS,
  recordAnswer,
  type AircraftProgress,
  type Verdict,
} from './trainer';

/**
 * What "Learn your controls" remembers, per aircraft, under the data root:
 *
 *   cheat-sheets/trainer.json    "<game>/<aircraft id>" -> rounds played, and per action how
 *                                often it was right and wrong and how many times running
 */

export const TrainerFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  aircraft: z.record(z.string(), AircraftProgressSchema).default({}),
});

const keyOf = (game: string, aircraftId: string): string => `${game}/${aircraftId}`;

export class TrainerStore {
  private readonly file: JsonStore<typeof TrainerFileSchema>;

  constructor(files: FileStore, folders: KnownFolders) {
    this.file = new JsonStore(
      files,
      path.join(folders.dataRoot(), 'cheat-sheets', 'trainer.json'),
      TrainerFileSchema
    );
  }

  /** What is remembered for one aircraft; nothing yet is an empty record, not an error. */
  async progress(game: string, aircraftId: string): Promise<Result<AircraftProgress>> {
    const all = await this.file.read();
    if (!all.ok) return all;
    return ok(all.value.aircraft[keyOf(game, aircraftId)] ?? EMPTY_PROGRESS);
  }

  /**
   * Adds answers (and, with `finished`, a round played to the end) to what is remembered.
   * Answers with what the file holds afterwards, read back.
   */
  async record(
    game: string,
    aircraftId: string,
    verdicts: Verdict[],
    finished: boolean,
    at: string
  ): Promise<Result<AircraftProgress>> {
    const key = keyOf(game, aircraftId);
    const saved = await this.file.update((all) => {
      let progress = all.aircraft[key] ?? EMPTY_PROGRESS;
      for (const verdict of verdicts) {
        progress = recordAnswer(progress, verdict.cardId, verdict.right, at);
      }
      if (finished) progress = { ...progress, rounds: progress.rounds + 1, lastPlayed: at };
      return { ...all, aircraft: { ...all.aircraft, [key]: progress } };
    });
    if (!saved.ok) return saved;
    const back = await this.progress(game, aircraftId);
    if (!back.ok) return back;
    // Read back: what was just answered is in the file.
    const kept = verdicts.every((v) => back.value.cards[v.cardId]?.last === at);
    return kept ? back : err('trainer.save', 'The progress could not be kept.');
  }
}
