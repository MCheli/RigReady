import { z } from 'zod';
import { ChangePreviewSchema } from '../../../shared/changePreview';

/** What crosses IPC and what is stored on disk for the Stream Deck feature. */

export const StreamDeckDeviceSchema = z.object({
  /** Product name as the device reports it, e.g. "Stream Deck XL". */
  name: z.string(),
  vendorId: z.string(),
  productId: z.string(),
  serial: z.string().optional(),
});
export type StreamDeckDevice = z.infer<typeof StreamDeckDeviceSchema>;

export const StreamDeckStatusSchema = z.object({
  installed: z.boolean(),
  /** StreamDeck.exe, when found. */
  exePath: z.string().optional(),
  /** From the uninstall entry, e.g. "7.4.2.22730". */
  version: z.string().optional(),
  running: z.boolean(),
  devices: z.array(StreamDeckDeviceSchema),
  /** %APPDATA%\Elgato\StreamDeck\ProfilesV3 (or ProfilesV2 for Stream Deck 6). */
  profilesFolder: z.string(),
  /** True when the profiles folder is the v7 layout RigReady can restore into file by file. */
  profilesV3: z.boolean(),
  pluginsFolder: z.string(),
});
export type StreamDeckStatus = z.infer<typeof StreamDeckStatusSchema>;

export const PluginUseSchema = z.object({
  pluginId: z.string(),
  actions: z.number().int(),
  /** Readable plugin name, when known. */
  name: z.string().optional(),
});

export const ProfileSummarySchema = z.object({
  /** Folder name without .sdProfile. */
  uuid: z.string(),
  name: z.string(),
  /** Elgato's model code, e.g. "20GAT9902". */
  deviceModel: z.string().optional(),
  /** Readable device name, e.g. "Stream Deck XL", when known. */
  deviceName: z.string().optional(),
  deviceSerial: z.string().optional(),
  /** True when the Stream Deck this profile was made for is connected now. */
  deviceConnected: z.boolean().optional(),
  pages: z.number().int(),
  actions: z.number().int(),
  /** Actions per plugin (built-in actions included under "com.elgato.streamdeck"). */
  plugins: z.array(PluginUseSchema),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const PluginSummarySchema = z.object({
  /** Plugin UUID, e.g. "com.ctytler.dcs". */
  id: z.string(),
  name: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  installed: z.boolean(),
  /** Actions that ship with the Stream Deck app (hotkeys, folders, ...). */
  builtIn: z.boolean(),
  /** Actions in all profiles that use this plugin. */
  actions: z.number().int(),
  /** Profiles that use it, with how many actions each. */
  profiles: z.array(z.object({ name: z.string(), actions: z.number().int() })),
  /** Where to get it, when RigReady knows. */
  source: z.object({ label: z.string(), url: z.string() }).optional(),
});
export type PluginSummary = z.infer<typeof PluginSummarySchema>;

export const InventorySchema = z.object({
  profiles: z.array(ProfileSummarySchema),
  plugins: z.array(PluginSummarySchema),
  totalActions: z.number().int(),
  /** Files that could not be read, in words for the user. */
  problems: z.array(z.string()),
});
export type Inventory = z.infer<typeof InventorySchema>;

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['bad', 'warn', 'info']),
  title: z.string(),
  detail: z.string(),
  /** What to do about it, in one or two sentences. */
  fix: z.string().optional(),
  /** A RigReady screen that fixes it. */
  route: z.object({ label: z.string(), to: z.string() }).optional(),
  /** A web page that helps (opened only after the user confirms). */
  link: z.object({ label: z.string(), url: z.string() }).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const BackupKindSchema = z.enum(['manual', 'before-restore', 'imported']);
export type BackupKind = z.infer<typeof BackupKindSchema>;

/** <data root>/stream-deck/backups/<id>.json, next to <id>.streamDeckProfilesBackup. */
export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  createdAt: z.string(),
  kind: BackupKindSchema,
  /** "v3": Profiles/<uuid>.sdProfile (Stream Deck 6.5+/7). "v2": <uuid>.sdProfile at the root. */
  format: z.enum(['v2', 'v3']),
  /** Stream Deck version on the PC when the backup was made. */
  appVersion: z.string().optional(),
  /** File name of an imported backup. */
  sourceFile: z.string().optional(),
  /** When the imported file itself was made (its modified time). */
  sourceModifiedAt: z.string().optional(),
  profiles: z.array(
    z.object({
      uuid: z.string(),
      name: z.string(),
      deviceName: z.string().optional(),
      pages: z.number().int(),
      actions: z.number().int(),
    })
  ),
  /** Plugins installed when the backup was made (the plugin list). */
  plugins: z.array(z.object({ id: z.string(), name: z.string(), version: z.string().optional() })),
  /** Plugins the profiles use, with action counts: what a new PC needs installed. */
  pluginsUsed: z.array(PluginUseSchema).default([]),
  /** True when the plugin folders were copied too (<id>.plugins.zip). */
  includesPluginFolders: z.boolean(),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const BackupSchema = BackupManifestSchema.extend({
  /** Archive size plus plugin archive size. */
  bytes: z.number().int(),
});
export type Backup = z.infer<typeof BackupSchema>;

export const ElgatoBackupSchema = z.object({
  fileName: z.string(),
  modifiedAt: z.string(),
  bytes: z.number().int(),
});
export type ElgatoBackup = z.infer<typeof ElgatoBackupSchema>;

export const RestorePreviewSchema = z.object({
  backup: BackupSchema,
  /** "files": RigReady writes the profiles itself. "app": the Stream Deck app imports the file. */
  method: z.enum(['files', 'app']),
  /** Why the app does the import, when it does. */
  methodReason: z.string().optional(),
  add: z.array(z.object({ uuid: z.string(), name: z.string() })),
  replace: z.array(z.object({ uuid: z.string(), name: z.string(), currentName: z.string() })),
  /** Profiles on the PC that are not in the backup; they are left alone. */
  keep: z.array(z.object({ uuid: z.string(), name: z.string() })),
  appRunning: z.boolean(),
  appInstalled: z.boolean(),
  /** For a "files" restore: what it writes and deletes in the profiles folder, file by file. */
  changes: ChangePreviewSchema.optional(),
  /** What restoring the plugin folders as well would write, when the backup has them. */
  pluginChanges: ChangePreviewSchema.optional(),
});
export type RestorePreview = z.infer<typeof RestorePreviewSchema>;

export const RestoreOutcomeSchema = z.object({
  method: z.enum(['files', 'app']),
  /** Journal group of the file restore: Undo on the Safety page puts everything back. */
  groupId: z.string().optional(),
  restored: z.number().int(),
  /** The automatic backup made of the profiles that were there before. */
  safetyBackupId: z.string().optional(),
  /** True when RigReady closed the Stream Deck app for the restore. */
  closedApp: z.boolean(),
  /** For an app restore: the profile names to look for once the user has confirmed in the app. */
  expected: z.array(z.string()),
});
export type RestoreOutcome = z.infer<typeof RestoreOutcomeSchema>;
