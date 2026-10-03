import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

export const ChangeSchema = z.object({
  id: z.string(),
  path: z.string(),
  /** What happened to the file. */
  kind: z.enum(['created', 'changed', 'deleted']),
  undone: z.boolean(),
});

export const ChangeGroupSchema = z.object({
  id: z.string(),
  time: z.string(),
  /** Why, in the words the feature gave when it made the change. */
  reason: z.string(),
  changes: z.array(ChangeSchema),
  undone: z.boolean(),
  /** True for an entry that is itself the undoing of an earlier one. */
  isUndo: z.boolean(),
});
export type ChangeGroupView = z.infer<typeof ChangeGroupSchema>;

export const SafetyViewSchema = z.object({
  groups: z.array(ChangeGroupSchema),
  /** Disk space used by the automatic backups. */
  backupBytes: z.number(),
  retention: z.object({ autoBackupDays: z.number(), autoBackupGroups: z.number() }),
  backupFolder: z.string(),
});
export type SafetyView = z.infer<typeof SafetyViewSchema>;

export const safetyContract = defineContract('safety', {
  /** Every change RigReady made outside its own folder, newest first, by user action. */
  journal: channel(noInput, SafetyViewSchema),
  /**
   * Puts every file of one action back the way it was. Fails with `journal.changed` when
   * a file was changed again since; `force` undoes anyway.
   */
  undo: channel(
    z.object({ groupId: z.string(), force: z.boolean().default(false) }),
    SafetyViewSchema
  ),
});
