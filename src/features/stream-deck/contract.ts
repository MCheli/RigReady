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
  overview: channel(noInput, OverviewSchema, {
    describe:
      "Everything the Stream Deck pages show: whether the Stream Deck app is installed and running, its profiles and plugins, problems found, RigReady's Stream Deck backups and the app's own automatic backups. Backup ids for the other channels come from here. Changes nothing.",
    tier: 'read',
  }),
  createBackup: channel(
    z.object({ name: z.string().max(120).optional(), includePlugins: z.boolean().default(false) }),
    BackupSchema,
    {
      describe:
        "Backs up the Stream Deck profiles (and plugins when includePlugins) into RigReady's folder under an optional name. Stream Deck's own files are only read.",
      tier: 'change',
    }
  ),
  renameBackup: channel(BackupId.extend({ name: z.string().min(1).max(120) }), BackupSchema, {
    describe: 'Gives a Stream Deck backup a new name. id comes from stream-deck:overview.',
    tier: 'change',
  }),
  deleteBackup: channel(BackupId, z.null(), {
    describe:
      "Deletes a Stream Deck backup from RigReady's folder for good. id comes from stream-deck:overview. Ask the user first.",
    tier: 'change',
  }),
  /** Save dialog, then a copy. Null when the user cancelled. */
  exportBackup: channel(BackupId, z.object({ path: z.string().nullable() }), {
    describe: 'Opens a save dialog and copies a backup to the file the user picks.',
    tier: 'off',
  }),
  /** Open dialog for a .streamDeckProfilesBackup file. Null when the user cancelled. */
  importFile: channel(noInput, z.object({ backup: BackupSchema.nullable() }), {
    describe: 'Opens a file dialog to import a .streamDeckProfilesBackup file.',
    tier: 'off',
  }),
  /** One of Stream Deck's own automatic backups, by file name. */
  importElgato: channel(z.object({ fileName: z.string().min(1).max(260) }), BackupSchema, {
    describe:
      "Copies one of the Stream Deck app's own automatic backups into RigReady's backups. fileName comes from elgatoBackups in stream-deck:overview.",
    tier: 'change',
  }),
  previewRestore: channel(BackupId, RestorePreviewSchema, {
    describe:
      'Shows what restoring a Stream Deck backup would do: which profiles are replaced or added, how it is done and whether the Stream Deck app is in the way. id comes from stream-deck:overview. Nothing is changed. Call it before stream-deck:restore and show the user.',
    tier: 'read',
  }),
  restore: channel(
    BackupId.extend({
      closeApp: z.boolean().default(false),
      force: z.boolean().default(false),
      restorePlugins: z.boolean().default(false),
    }),
    RestoreOutcomeSchema,
    {
      describe:
        'Puts the profiles of a backup back, keeping what is there now as a backup of its own. The Stream Deck app must be closed; closeApp lets RigReady close it (force ends it if it does not quit). Call stream-deck:previewRestore first and show the user.',
      tier: 'change',
    }
  ),
  verifyAppRestore: channel(
    BackupId,
    z.object({ found: z.array(z.string()), missing: z.array(z.string()) }),
    {
      describe:
        'After a restore done through the Stream Deck app, says which profiles of the backup the app now has and which are missing. id is the restored backup. Changes nothing.',
      tier: 'read',
    }
  ),
  undoRestore: channel(
    z.object({ groupId: z.string().min(1), force: z.boolean().default(false) }),
    z.null(),
    {
      describe:
        'Puts back what a file restore of Stream Deck profiles changed. groupId comes from the answer of stream-deck:restore. The Stream Deck app must be closed.',
      tier: 'change',
    }
  ),
  startApp: channel(noInput, z.object({ message: z.string() }), {
    describe: 'Starts the Stream Deck app.',
    tier: 'change',
  }),
});
