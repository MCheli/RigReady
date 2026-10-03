import { z } from 'zod';
import { CaptureCandidateSchema } from '../../core/checks/engine';
import { CheckItemSchema, ProfileSchema } from '../../core/profile/schema';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';

export const NewProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  game: z.string().optional(),
  launch: LaunchTargetSchema.optional(),
  /** Checks chosen from the capture; ids are assigned on creation. */
  checks: z.array(CheckItemSchema.omit({ id: true })),
});
export type NewProfile = z.infer<typeof NewProfileSchema>;

export const profilesContract = defineContract('profiles', {
  list: channel(noInput, z.array(ProfileSchema)),
  get: channel(z.object({ id: z.string() }), ProfileSchema),
  /** Replaces an existing profile. */
  save: channel(ProfileSchema, ProfileSchema),
  remove: channel(z.object({ id: z.string() }), z.object({ removed: z.boolean() })),
  /** Looks at the machine as it is now and proposes checks. */
  capture: channel(
    noInput,
    z.object({ candidates: z.array(CaptureCandidateSchema), problems: z.array(z.string()) })
  ),
  create: channel(NewProfileSchema, ProfileSchema),
});
