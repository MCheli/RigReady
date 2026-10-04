import { z } from 'zod';

/** What a kneeboard export writes. Kept apart from the export itself so the window can use it. */
export const KneeboardOptionsSchema = z.object({
  /** Device keys to export; empty means every device with something bound. */
  devices: z.array(z.string()).default([]),
  styles: z
    .array(z.enum(['light', 'night']))
    .min(1)
    .default(['light']),
  /** A first page listing the most important actions. */
  summary: z.boolean().default(true),
  /** Large-print list pages after each device's picture. */
  lists: z.boolean().default(false),
});
export type KneeboardOptions = z.infer<typeof KneeboardOptionsSchema>;
