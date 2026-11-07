import { z } from 'zod';
import { TrackedItemSchema } from '../../core/trackedSchema';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';

const ItemViewSchema = z.object({
  item: TrackedItemSchema,
  absolute: z.string().optional(),
  problem: z.string().optional(),
  exists: z.boolean(),
  fileCount: z.number(),
  totalBytes: z.number(),
  /** Files left out because they hold credentials. */
  withheld: z.number(),
});
export type ItemView = z.infer<typeof ItemViewSchema>;

const ScopeViewSchema = z.object({
  /** "@always" for the "Always back up" list, else a profile id. */
  id: z.string(),
  name: z.string(),
  game: z.string().optional(),
  items: z.array(ItemViewSchema),
});
export type ScopeView = z.infer<typeof ScopeViewSchema>;

export const BackupViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  machine: z.string(),
  appVersion: z.string(),
  scopeKind: z.enum(['full', 'profile', 'custom', 'before-restore']),
  scopeLabel: z.string(),
  size: z.number(),
  fileCount: z.number(),
  totalBytes: z.number(),
  items: z.array(
    z.object({
      label: z.string(),
      game: z.string().optional(),
      fileCount: z.number(),
      sourceName: z.string(),
    })
  ),
  /** Settings kept as data (registry values): readable, never restored. */
  records: z.array(z.object({ label: z.string(), from: z.string() })).default([]),
  profiles: z.array(z.string()),
  /** Snapshots in the backup, by name. */
  snapshots: z.array(z.string()).default([]),
  /** Setups whose "what changed" record is in the backup, by name. */
  changeRecords: z.array(z.string()).default([]),
  imported: z.boolean(),
  damaged: z.string().optional(),
});
export type BackupView = z.infer<typeof BackupViewSchema>;

const OverviewSchema = z.object({
  scopes: z.array(ScopeViewSchema),
  backups: z.array(BackupViewSchema),
  keepBackups: z.number(),
  folder: z.string(),
  /** Game modules, for labelling tracked items. */
  games: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type Overview = z.infer<typeof OverviewSchema>;

const SuggestionSchema = z.object({
  key: z.string(),
  source: z.string(),
  label: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'folder']),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  game: z.string().optional(),
  description: z.string().optional(),
  fileCount: z.number(),
  totalBytes: z.number(),
  trackedIn: z.array(z.string()),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const ItemDraftSchema = z.object({
  id: z.string().optional(),
  label: z.string().max(200),
  path: z.string().max(2048),
  kind: z.enum(['file', 'folder']),
  include: z.array(z.string().max(200)).max(50).default([]),
  exclude: z.array(z.string().max(200)).max(50).default([]),
  game: z.string().max(64).optional(),
});
export type ItemDraftInput = z.input<typeof ItemDraftSchema>;

const ItemPreviewSchema = z.object({
  path: z.string(),
  absolute: z.string().optional(),
  problem: z.string().optional(),
  exists: z.boolean(),
  kind: z.enum(['file', 'folder']),
  files: z.array(z.object({ relativePath: z.string(), size: z.number() })),
  fileCount: z.number(),
  totalBytes: z.number(),
  withheld: z.array(z.object({ relativePath: z.string(), reason: z.string() })),
});
export type ItemPreview = z.infer<typeof ItemPreviewSchema>;

const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ kind: z.literal('profile'), profileId: z.string() }),
  z.object({
    kind: z.literal('custom'),
    label: z.string().max(120),
    items: z.array(z.object({ scope: z.string(), id: z.string() })).min(1),
  }),
]);

const PathReason = z.object({ path: z.string(), reason: z.string() });

const OutcomeSchema = z.object({
  backup: BackupViewSchema,
  skipped: z.array(PathReason),
  withheld: z.array(PathReason),
  pruned: z.array(z.string()),
});
export type BackupOutcomeView = z.infer<typeof OutcomeSchema>;

const FileStatusSchema = z.enum(['new', 'same', 'different']);

const PreviewSchema = z.object({
  backup: BackupViewSchema,
  otherMachine: z.boolean(),
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      game: z.string().optional(),
      sourceName: z.string(),
      fileCount: z.number(),
      stored: z.string(),
      absolute: z.boolean(),
      target: z.string().optional(),
      restorable: z.boolean(),
      problem: z.string().optional(),
      files: z.array(
        z.object({
          ref: z.string(),
          relativePath: z.string(),
          target: z.string(),
          size: z.number(),
          status: FileStatusSchema,
          program: z.boolean(),
        })
      ),
    })
  ),
  own: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(['profile', 'layout', 'settings', 'tracked', 'snapshot', 'changes']),
      label: z.string(),
      status: FileStatusSchema,
      detail: z.string().optional(),
      /** Set when it cannot be restored from this backup: why. */
      problem: z.string().optional(),
    })
  ),
  notInBackup: z.array(PathReason),
  /** Games and tools running now that hold files of this backup: close them before restoring. */
  running: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      why: z.string(),
      processes: z.array(z.string()),
      restart: z.boolean(),
      items: z.array(z.string()),
    })
  ),
  records: z.array(
    z.object({
      label: z.string(),
      from: z.string(),
      source: z.string(),
      rows: z.array(
        z.object({
          group: z.string(),
          label: z.string(),
          name: z.string().optional(),
          value: z.string(),
        })
      ),
      moreRows: z.boolean(),
      text: z.string(),
      truncated: z.boolean(),
    })
  ),
});
export type RestorePreviewView = z.infer<typeof PreviewSchema>;

const Entry = z.object({ ref: z.string(), label: z.string(), detail: z.string().optional() });
const ReportSchema = z.object({
  name: z.string(),
  restored: z.array(Entry),
  unchanged: z.array(Entry),
  keptBoth: z.array(Entry),
  skipped: z.array(Entry),
  failed: z.array(Entry),
  groupId: z.string().optional(),
  safetyBackup: z.string().optional(),
  deviceIds: z.object({ files: z.array(z.string()), message: z.string() }).optional(),
  closed: z.array(z.object({ name: z.string(), restarted: z.boolean().optional() })).default([]),
});
export type RestoreReportView = z.infer<typeof ReportSchema>;

const DiffSchema = z.object({
  added: z.number(),
  removed: z.number(),
  tooLarge: z.boolean().optional(),
  hunks: z.array(
    z.object({
      oldStart: z.number(),
      newStart: z.number(),
      lines: z.array(z.object({ kind: z.enum([' ', '+', '-']), text: z.string() })),
    })
  ),
});

const ComparisonSchema = z.object({
  unchanged: z.number(),
  changes: z.array(
    z.object({
      key: z.string(),
      path: z.string().optional(),
      status: z.enum(['added', 'removed', 'changed']),
      binary: z.boolean(),
      diff: DiffSchema.optional(),
      note: z.string().optional(),
    })
  ),
});
export type ComparisonView = z.infer<typeof ComparisonSchema>;

const SnapshotViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  scope: z.string(),
  itemLabel: z.string(),
  itemPath: z.string(),
  fileCount: z.number(),
  totalBytes: z.number(),
});
export type SnapshotView = z.infer<typeof SnapshotViewSchema>;

const ChangesSchema = z.object({
  profileId: z.string(),
  trackedItems: z.number(),
  knownGood: z.object({ time: z.string(), reason: z.string(), fileCount: z.number() }).optional(),
  comparison: ComparisonSchema.optional(),
});
export type ChangesViewData = z.infer<typeof ChangesSchema>;

const Id = z.object({ id: z.string().min(1).max(200) });
const ScopeRef = z.string().min(1).max(80);

export const backupContract = defineContract(
  'backup',
  {
    /** Tracked items of every scope with what they cover now, and the backups list. */
    overview: channel(noInput, OverviewSchema, {
      describe:
        'The Backups page: every tracked item by scope ("@always" for the Always back up list, else a setup id) with the files it covers now, and the list of backups. Backup ids here are what restore, rename and remove take.',
      tier: 'read',
    }),
    suggestions: channel(noInput, z.array(SuggestionSchema), {
      describe:
        'Files and folders on this PC worth tracking (game settings, bindings, tool configs) and which scopes already track them. Use it to propose items for saveItem.',
      tier: 'read',
    }),
    /** Which files an item would cover, before it is saved. */
    previewItem: channel(ItemDraftSchema, ItemPreviewSchema, {
      describe:
        'Which files a tracked item draft would cover, and which are withheld because they hold credentials, before it is saved. Call it before saveItem and show the user.',
      tier: 'read',
    }),
    saveItem: channel(z.object({ scope: ScopeRef, item: ItemDraftSchema }), OverviewSchema, {
      describe:
        'Adds or updates a tracked item in a scope ("@always" or a setup id from profiles:list). Call previewItem first and show the user which files it covers.',
      tier: 'change',
    }),
    removeItem: channel(z.object({ scope: ScopeRef, id: z.string() }), OverviewSchema, {
      describe:
        'Stops tracking one item in a scope. The item id comes from backup:overview. Existing backups are kept.',
      tier: 'change',
    }),
    /** A native picker; null when cancelled. */
    browse: channel(
      z.object({ kind: z.enum(['file', 'folder']) }),
      z.object({ path: z.string(), label: z.string() }).nullable(),
      {
        describe: 'A native file or folder picker for choosing what to track; null when cancelled.',
        tier: 'off',
      }
    ),
    backUp: channel(z.object({ scope: ScopeSchema }), OutcomeSchema, {
      describe:
        'Writes a new backup: the full set, one setup (profileId from profiles:list) or a custom list of items from backup:overview. Older backups beyond the keep count are removed.',
      tier: 'change',
    }),
    /**
     * Stops the backup that is running, before anything is written: `backUp` then answers
     * with `backup.cancelled`. `cancelling` is false when no backup is running.
     */
    cancelBackUp: channel(noInput, z.object({ cancelling: z.boolean() }), {
      describe:
        'Stops the backup that is running before anything is written. cancelling is false when no backup is running.',
      tier: 'change',
    }),
    /** Whether a backup is running now, and how far it is: for a screen that opens meanwhile. */
    backUpStatus: channel(
      noInput,
      z.object({
        running: z.boolean(),
        progress: z.object({ done: z.number(), total: z.number(), label: z.string() }).optional(),
      }),
      { describe: 'Whether a backup is running now and how far it is.', tier: 'read' }
    ),
    rename: channel(z.object({ id: z.string(), name: z.string().max(200) }), BackupViewSchema, {
      describe: 'Renames a backup. The id comes from backup:overview.',
      tier: 'change',
    }),
    remove: channel(Id, z.object({ removed: z.boolean() }), {
      describe:
        'Deletes a backup file. The id comes from backup:overview. This cannot be undone, so ask the user first.',
      tier: 'change',
    }),
    /** Copies a backup to a place the user picks; null when cancelled. */
    exportBackup: channel(Id, z.object({ path: z.string() }).nullable(), {
      describe: 'Copies a backup to a place the user picks with a dialog; null when cancelled.',
      tier: 'off',
    }),
    reveal: channel(Id, z.object({ shown: z.boolean() }), {
      describe: 'Shows a backup file in Explorer.',
      tier: 'off',
    }),
    /** Adds a backup file from elsewhere to the list, after checking it; null when cancelled. */
    openFile: channel(noInput, BackupViewSchema.nullable(), {
      describe:
        'Asks the user for a backup file from elsewhere with a dialog, checks it and adds it to the list; null when cancelled.',
      tier: 'off',
    }),
    setKeep: channel(z.object({ keepBackups: z.number().int() }), OverviewSchema, {
      describe: 'Sets how many backups RigReady keeps; older ones are removed at the next backup.',
      tier: 'change',
    }),
    previewRestore: channel(Id, PreviewSchema, {
      describe:
        'What restoring a backup would do: each file new, same or different, programs that hold the files, and what cannot be restored. The id comes from backup:overview. Call it before restore and show the user.',
      tier: 'read',
    }),
    restore: channel(
      z.object({
        id: z.string(),
        choices: z.record(z.string(), z.enum(['overwrite', 'keepBoth'])),
        /** Ask the games and tools that hold the files to close first (never by force). */
        closePrograms: z.boolean().default(false),
      }),
      ReportSchema,
      {
        describe:
          'Puts a backup back. choices maps file refs from backup:previewRestore to overwrite or keepBoth; closePrograms asks the programs holding the files to close. Call previewRestore first and show the user. Undo is on the Safety page.',
        tier: 'change',
      }
    ),
    snapshots: channel(noInput, z.array(SnapshotViewSchema), {
      describe:
        'Snapshots of single tracked items, newest first. Snapshot ids here are what compareSnapshot, restoreSnapshot, renameSnapshot and removeSnapshot take.',
      tier: 'read',
    }),
    takeSnapshot: channel(
      z.object({ scope: ScopeRef, itemId: z.string(), name: z.string().max(200) }),
      SnapshotViewSchema,
      {
        describe:
          'Saves a named snapshot of one tracked item. scope is "@always" or a setup id and itemId comes from backup:overview.',
        tier: 'change',
      }
    ),
    compareSnapshot: channel(
      Id,
      z.object({
        snapshot: SnapshotViewSchema,
        comparison: ComparisonSchema,
        folder: z.string().optional(),
      }),
      {
        describe:
          'How a snapshot differs from the files on disk now, file by file. The id comes from backup:snapshots.',
        tier: 'read',
      }
    ),
    restoreSnapshot: channel(
      Id,
      z.object({ written: z.number(), leftAlone: z.number(), groupId: z.string().optional() }),
      {
        describe:
          'Puts a snapshot back over the files on disk. Call restoreSnapshotPreview first and show the user. Undo it on the Safety page with the groupId it returns.',
        tier: 'change',
      }
    ),
    /** Which files putting that snapshot back would change and how. Reads only. */
    restoreSnapshotPreview: channel(Id, ChangePreviewSchema, {
      describe:
        'Which files putting a snapshot back would change and how. The id comes from backup:snapshots. Reads only.',
      tier: 'read',
    }),
    renameSnapshot: channel(
      z.object({ id: z.string(), name: z.string().max(200) }),
      SnapshotViewSchema,
      { describe: 'Renames a snapshot. The id comes from backup:snapshots.', tier: 'change' }
    ),
    removeSnapshot: channel(Id, z.object({ removed: z.boolean() }), {
      describe: 'Deletes a snapshot. The id comes from backup:snapshots. Ask the user first.',
      tier: 'change',
    }),
    /** What differs now from the last time the setup worked. */
    changes: channel(z.object({ profileId: z.string() }), ChangesSchema, {
      describe:
        "What differs in a setup's tracked files since the last time the setup worked. profileId comes from profiles:list. Use it when a setup stopped working.",
      tier: 'read',
    }),
    /** Records the setup's tracked files as working, now. */
    markWorking: channel(z.object({ profileId: z.string() }), ChangesSchema, {
      describe:
        "Records a setup's tracked files as working now, replacing the earlier record that changes compares against. profileId comes from profiles:list.",
      tier: 'change',
    }),
  },
  {
    progress: z.object({ done: z.number(), total: z.number(), label: z.string() }),
    /** The backup that was running has ended: written, failed or cancelled. */
    ended: z.object({ cancelled: z.boolean() }),
    /** A game start was noticed and the setup's files were recorded as working. */
    recorded: z.object({ profileId: z.string() }),
  }
);
