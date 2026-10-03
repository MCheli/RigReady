import { bind, defineFeatureMain, type MainContext } from '../../core/feature';
import { ok, type Result } from '../../core/result';
import packageJson from '../../../package.json';
import { backupContract } from './contract';
import {
  addBackupFile,
  createBackup,
  exportBackup,
  listBackups,
  removeBackup,
  renameBackup,
  revealBackup,
  type BackupScope,
} from './core/archive';
import { changesSinceWorked, LaunchWatcher, recordFingerprint } from './core/fingerprints';
import { browseForItem, removeItem, saveItem, scopeViews, previewItem } from './core/items';
import { applyRestore, previewRestore } from './core/restore';
import {
  compareSnapshot,
  listSnapshots,
  removeSnapshot,
  renameSnapshot,
  restoreSnapshot,
  takeSnapshot,
} from './core/snapshots';
import { backupRoot, machineIdentity, prefsStore } from './core/store';
import { dcsBackupSource } from './core/suggestions';
import { collectSuggestions } from './core/suggestions';
import { allScopes } from './core/store';

/** How often running programs are looked at to notice a game start. */
const WATCH_MS = 3000;

let watcher: LaunchWatcher | undefined;

async function overview(ctx: MainContext) {
  const scopes = await scopeViews(ctx);
  if (!scopes.ok) return scopes;
  const backups = await listBackups(ctx);
  if (!backups.ok) return backups;
  const prefs = await prefsStore(ctx).read();
  if (!prefs.ok) return prefs;
  return ok({
    scopes: scopes.value,
    backups: backups.value,
    keepBackups: prefs.value.keepBackups,
    games: ctx.games.all().map((g) => ({ id: g.id, name: g.name })),
    folder: backupRoot(ctx),
  });
}

const after = async <T, U>(
  first: Promise<Result<T>>,
  then: () => Promise<Result<U>>
): Promise<Result<U>> => {
  const done = await first;
  return done.ok ? then() : done;
};

export default defineFeatureMain({
  id: 'backup',
  setup(ctx) {
    ctx.backupSources.register(dcsBackupSource);
    const identity = () => machineIdentity(ctx);
    const appVersion = packageJson.version;
    watcher = new LaunchWatcher(ctx, (profileId) =>
      ctx.emit(backupContract, 'recorded', { profileId })
    );
    watcher.start(WATCH_MS);
    void watcher.poll();

    return [
      bind(backupContract, {
        overview: () => overview(ctx),
        suggestions: async () => {
          const scopes = await allScopes(ctx);
          if (!scopes.ok) return scopes;
          return ok(await collectSuggestions(ctx, scopes.value));
        },
        previewItem: (draft) => previewItem(ctx, draft),
        saveItem: ({ scope, item }) => after(saveItem(ctx, scope, item), () => overview(ctx)),
        removeItem: ({ scope, id }) => after(removeItem(ctx, scope, id), () => overview(ctx)),
        browse: ({ kind }) => browseForItem(ctx, kind),
        backUp: ({ scope }) =>
          createBackup(ctx, scope as BackupScope, {
            identity: identity(),
            appVersion,
            onProgress: (p) => ctx.emit(backupContract, 'progress', p),
          }),
        rename: ({ id, name }) => renameBackup(ctx, id, name),
        remove: ({ id }) => after(removeBackup(ctx, id), async () => ok({ removed: true })),
        exportBackup: ({ id }) => exportBackup(ctx, id),
        reveal: ({ id }) => after(revealBackup(ctx, id), async () => ok({ shown: true })),
        openFile: () => addBackupFile(ctx),
        setKeep: ({ keepBackups }) =>
          after(
            prefsStore(ctx).update((prefs) => ({ ...prefs, keepBackups })),
            () => overview(ctx)
          ),
        previewRestore: ({ id }) => previewRestore(ctx, id, identity()),
        restore: ({ id, choices }) =>
          applyRestore(ctx, id, choices, { identity: identity(), appVersion }),
        snapshots: () => listSnapshots(ctx),
        takeSnapshot: ({ scope, itemId, name }) => takeSnapshot(ctx, scope, itemId, name),
        compareSnapshot: ({ id }) => compareSnapshot(ctx, id),
        restoreSnapshot: ({ id }) => restoreSnapshot(ctx, id),
        renameSnapshot: ({ id, name }) => renameSnapshot(ctx, id, name),
        removeSnapshot: ({ id }) =>
          after(removeSnapshot(ctx, id), async () => ok({ removed: true })),
        changes: ({ profileId }) => changesSinceWorked(ctx, profileId),
        markWorking: ({ profileId }) =>
          after(recordFingerprint(ctx, profileId, 'Marked as working'), () =>
            changesSinceWorked(ctx, profileId)
          ),
      }),
    ];
  },
  dispose() {
    watcher?.stop();
  },
});
