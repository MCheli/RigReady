import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';

export const GameSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  installs: z.array(
    z.object({
      source: z.enum(['steam', 'standalone', 'store']),
      installDir: z.string(),
      launch: LaunchTargetSchema.optional(),
    })
  ),
  configLocations: z.array(z.object({ id: z.string(), label: z.string(), path: z.string() })),
  problems: z.array(z.string()),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

export const gamesContract = defineContract('games', {
  /** Every registered game module with what was detected on this PC. */
  list: channel(noInput, z.array(GameSummarySchema)),
});
