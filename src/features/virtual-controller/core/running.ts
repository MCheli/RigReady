import { z } from 'zod';
import { VirtualPadKindSchema } from '../../../shared/models';

/** A virtual controller that is running, as the window, the tray and the Play screen show it. */
export const RunningSchema = z.object({
  profileId: z.string(),
  profileName: z.string(),
  kind: VirtualPadKindSchema,
  /** "setup": a setup's launch step started it, and its Stand down stops it. "hand": the user did. */
  by: z.enum(['setup', 'hand']),
  /** The setup that started it. */
  setup: z.string().optional(),
  startedAt: z.string(),
  /** The controllers that drive it, by name. */
  controllers: z.array(z.string()),
  /** Parts of the profile whose controller is not connected. */
  missing: z.array(z.string()),
  /** The real controllers hidden from games while it runs. */
  hidden: z.array(z.string()),
  /** Controllers that were asked to be hidden and could not be. */
  notHidden: z.array(z.string()),
});
export type Running = z.infer<typeof RunningSchema>;
