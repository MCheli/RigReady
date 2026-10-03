import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';

export const GameSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['racing', 'flight']).optional(),
  installs: z.array(
    z.object({
      source: z.enum(['steam', 'standalone', 'store']),
      installDir: z.string(),
      launch: LaunchTargetSchema.optional(),
    })
  ),
  /** Of the first install. */
  version: z.object({ version: z.string(), updatePending: z.boolean().optional() }).optional(),
  /** One of the game's processes is running now. */
  running: z.boolean().default(false),
  configLocations: z.array(z.object({ id: z.string(), label: z.string(), path: z.string() })),
  trackedFiles: z.array(z.object({ label: z.string(), path: z.string() })).default([]),
  /** What RigReady can and cannot do for this game, in plain words. */
  notes: z.array(z.string()).default([]),
  /** Facts about this PC ("Last run as 0.38.5"). */
  facts: z.array(z.string()).default([]),
  /** When the game can be pointed at by hand: what to choose, and the folder chosen. */
  manualFolder: z.object({ label: z.string(), chosen: z.string().optional() }).optional(),
  problems: z.array(z.string()),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

const GameId = z.object({ gameId: z.string().regex(/^[a-z0-9-]+$/) });

export const gamesContract = defineContract('games', {
  /** Every registered game module with what was detected on this PC. */
  list: channel(noInput, z.array(GameSummarySchema)),
  /** One game, the same as in list(). */
  get: channel(GameId, GameSummarySchema),
  /**
   * Asks the user for the game's folder and remembers it when it holds the game.
   * `chosen` is false when the picker was cancelled.
   */
  chooseFolder: channel(GameId, z.object({ chosen: z.boolean(), game: GameSummarySchema })),
  /** Forgets a folder chosen by hand. */
  forgetFolder: channel(GameId, GameSummarySchema),
  /** Starts the game from its first install. Resolves with what happened, in words. */
  launch: channel(GameId, z.object({ message: z.string() })),
});
