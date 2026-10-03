import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import {
  BackupSchema,
  ElgatoBackupSchema,
  FindingSchema,
  InventorySchema,
  RestoreOutcomeSchema,
  RestorePreviewSchema,
  StreamDeckStatusSchema,
} from './core/model';

export const OverviewSchema = z.object({
  status: StreamDeckStatusSchema,
  inventory: InventorySchema,
  findings: z.array(FindingSchema),
  backups: z.array(BackupSchema),
  /** Backup manifests that could not be read. */
  damagedBackups: z.number().int(),
  elgatoBackups: z.array(ElgatoBackupSchema),
  downloadUrl: z.string(),
});
export type Overview = z.infer<typeof OverviewSchema>;

const BackupId = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) });

export const streamDeckContract = defineContract('stream-deck', {
  /** Everything the Stream Deck screens show. */
  overview: channel(noInput, OverviewSchema),
  createBackup: channel(
    z.object({ name: z.string().max(120).optional(), includePlugins: z.boolean().default(false) }),
    BackupSchema
  ),
  renameBackup: channel(BackupId.extend({ name: z.string().min(1).max(120) }), BackupSchema),
  deleteBackup: channel(BackupId, z.null()),
  /** Save dialog, then a copy. Null when the user cancelled. */
  exportBackup: channel(BackupId, z.object({ path: z.string().nullable() })),
  /** Open dialog for a .streamDeckProfilesBackup file. Null when the user cancelled. */
  importFile: channel(noInput, z.object({ backup: BackupSchema.nullable() })),
  /** One of Stream Deck's own automatic backups, by file name. */
  importElgato: channel(z.object({ fileName: z.string().min(1).max(260) }), BackupSchema),
  previewRestore: channel(BackupId, RestorePreviewSchema),
  restore: channel(
    BackupId.extend({
      closeApp: z.boolean().default(false),
      force: z.boolean().default(false),
      restorePlugins: z.boolean().default(false),
    }),
    RestoreOutcomeSchema
  ),
  verifyAppRestore: channel(
    BackupId,
    z.object({ found: z.array(z.string()), missing: z.array(z.string()) })
  ),
  undoRestore: channel(
    z.object({ groupId: z.string().min(1), force: z.boolean().default(false) }),
    z.null()
  ),
  startApp: channel(noInput, z.object({ message: z.string() })),
});
