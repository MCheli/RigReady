import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { TrackIrProfilesSchema, TrackIrStatusSchema } from './core/trackir';

export const TrackIrOverviewSchema = z.object({
  status: TrackIrStatusSchema,
  profiles: TrackIrProfilesSchema,
  downloadUrl: z.string(),
});
export type TrackIrOverview = z.infer<typeof TrackIrOverviewSchema>;

export const trackIrContract = defineContract('trackir', {
  overview: channel(noInput, TrackIrOverviewSchema),
  start: channel(noInput, z.object({ message: z.string() })),
});
