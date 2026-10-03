import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DisplayLayoutSchema } from '../../shared/models';

export const displaysContract = defineContract(
  'displays',
  {
    read: channel(noInput, DisplayLayoutSchema),
    /** Whether a keep-or-revert decision is open, and how long the countdown is in total. */
    pending: channel(noInput, z.object({ pending: z.boolean(), seconds: z.number() })),
    /** Keep the layout that was just applied. */
    keep: channel(noInput, z.object({ kept: z.boolean() })),
    /** Go back to the layout from before the last apply. */
    revert: channel(noInput, DisplayLayoutSchema),
  },
  {
    /** A layout was applied; it reverts by itself after `seconds` unless kept. */
    applied: z.object({ seconds: z.number() }),
    settled: z.object({ outcome: z.enum(['kept', 'reverted', 'revertFailed']) }),
  }
);
