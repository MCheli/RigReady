import { z } from 'zod';
import { ActionReportSchema, ChecklistReportSchema } from '../../core/checks/engine';
import { channel, defineContract, noInput } from '../../shared/ipc';

const ProfileRef = z.object({ profileId: z.string() });

export const flyContract = defineContract('fly', {
  /** What the Fly screen needs to draw itself before any check has run. */
  state: channel(
    noInput,
    z.object({
      profiles: z.array(z.object({ id: z.string(), name: z.string(), canLaunch: z.boolean() })),
      /** The profile to show: the last used one if it still exists, else the first. */
      activeProfileId: z.string().optional(),
    })
  ),
  /** Runs the profile's checklist and remembers it as the last used profile. */
  check: channel(ProfileRef, ChecklistReportSchema),
  makeReady: channel(ProfileRef, ActionReportSchema),
  standDown: channel(ProfileRef, ActionReportSchema),
  /** Starts the game. Never blocked by failing checks; the screen warns first. */
  launch: channel(ProfileRef, z.object({ message: z.string() })),
});
