import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

export const UpdateChannelSchema = z.enum(['stable', 'beta']);

/**
 * Where the updater is:
 * unsupported  this run cannot update (development run); `message` says why
 * idle         nothing checked yet
 * checking     asking the feed
 * upToDate     the feed has nothing newer for this channel
 * noRelease    nothing is published on this channel at all
 * downloading  a newer version is coming down in the background (`percent`)
 * ready        downloaded; installed on "Restart to install" or at the next quit
 * installing   the user confirmed; RigReady is about to quit
 * error        the last check or download failed (`message`)
 */
export const UpdatePhaseSchema = z.enum([
  'unsupported',
  'idle',
  'checking',
  'upToDate',
  'noRelease',
  'downloading',
  'ready',
  'installing',
  'error',
]);

export const UpdateStatusSchema = z.object({
  phase: UpdatePhaseSchema,
  currentVersion: z.string(),
  channel: UpdateChannelSchema,
  /** Whether RigReady checks by itself (at start and daily). */
  automatic: z.boolean(),
  /** The newer version, from "downloading" on. */
  version: z.string().optional(),
  notes: z.string().optional(),
  percent: z.number().optional(),
  /** ISO time of the last finished check. */
  checkedAt: z.string().optional(),
  message: z.string().optional(),
  /** Set when an install was refused: the game that is running. */
  blockedBy: z.string().optional(),
  /** Whether the downloaded version would be installed if RigReady quit now (never while a game runs). */
  installsOnQuit: z.boolean(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>;

export const updatesContract = defineContract(
  'updates',
  {
    status: channel(noInput, UpdateStatusSchema),
    /** Checks now, whatever the automatic setting says; a newer version is downloaded. */
    check: channel(noInput, UpdateStatusSchema),
    /** "Restart to install": refused (update.gameRunning) while a game is running. */
    install: channel(noInput, UpdateStatusSchema),
    setPreferences: channel(
      z.object({ automatic: z.boolean().optional(), channel: UpdateChannelSchema.optional() }),
      UpdateStatusSchema
    ),
  },
  { status: UpdateStatusSchema }
);
