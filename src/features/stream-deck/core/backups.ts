import path from 'node:path';
import { z } from 'zod';
import { changePreview, type PlannedWrite } from '../../../core/files/preview';
import { createZip, readZip, zipFolder, type ZipEntry } from '../../../core/files/zip';
import type { Ports, TreeEntry } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { ChangePreview } from '../../../shared/changePreview';
import { closeApp, isAppRunning, appExe, type Sleep, realSleep } from './app';
import { profileRelativePath, readArchiveManifests } from './archive';
import { detectStreamDeck, streamDeckPaths, type StreamDeckPaths } from './detect';
import {
  buildInventory,
  readInstalledPlugins,
  readProfileManifests,
  readProfiles,
  type InstalledPlugin,
  type ManifestFile,
  type ParsedProfile,
} from './inventory';
import {
  BackupManifestSchema,
  type Backup,
  type BackupKind,
  type BackupManifest,
  type ElgatoBackup,
  type RestoreOutcome,
  type RestorePreview,
} from './model';

export const ARCHIVE_EXT = '.streamDeckProfilesBackup';
const PLUGINS_EXT = '.plugins.zip';
/** Elgato's own backups carry this resources manifest; kept so the archive matches theirs. */
const RESOURCES_MANIFEST = '{\n  "resources": null\n}\n';

export interface BackupOptions {
  /** Upper bound for anything read from an archive (Settings: import size). */
  maxBytes(): Promise<number>;
  sleep?: Sleep;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function stamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** A file name a user can recognise, without characters Windows rejects. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/[. ]+$/, '') || 'Stream Deck backup';
}

const ELGATO_FILE = /^[^\\/:*?"<>|]+\.streamDeckProfilesBackup$/i;

const sameTree = (a: TreeEntry[], b: TreeEntry[]): boolean =>
  a.length === b.length &&
  a.every(
    (entry, i) =>
      entry.relativePath === b[i]!.relativePath &&
      entry.mtimeMs === b[i]!.mtimeMs &&
      entry.size === b[i]!.size
  );

function summarise(
  parsed: { profiles: ParsedProfile[]; problems: string[] },
  installed: InstalledPlugin[]
): Pick<BackupManifest, 'profiles' | 'pluginsUsed'> {
  const inventory = buildInventory(parsed, installed);
  return {
    profiles: inventory.profiles.map((p) => ({
      uuid: p.uuid,
      name: p.name,
      ...(p.deviceName ? { deviceName: p.deviceName } : {}),
      pages: p.pages,
      actions: p.actions,
    })),
    pluginsUsed: inventory.plugins
      .filter((p) => !p.builtIn && p.actions > 0)
      .map((p) => ({ pluginId: p.id, name: p.name, actions: p.actions })),
  };
}

/**
 * RigReady's Stream Deck backups: <data root>/stream-deck/backups/<id>.json (the manifest)
 * next to <id>.streamDeckProfilesBackup (the profiles, in the same ZIP layout Stream Deck 7
 * uses) and, when plugin folders were included, <id>.plugins.zip.
 */
export class StreamDeckBackups {
  private readonly sleep: Sleep;
  constructor(
    private readonly ports: Ports,
    private readonly options: BackupOptions
  ) {
    this.sleep = options.sleep ?? realSleep;
  }

  private paths(): Promise<StreamDeckPaths> {
    return streamDeckPaths(this.ports);
  }

  private file(paths: StreamDeckPaths, id: string, ext: string): string {
    return path.join(paths.backupsDir, `${id}${ext}`);
  }

  async list(): Promise<Result<{ backups: Backup[]; damaged: number }>> {
    const paths = await this.paths();
    const entries = await this.ports.files.listEntries(paths.backupsDir);
    if (!entries.ok) return entries;
    const backups: Backup[] = [];
    let damaged = 0;
    for (const entry of entries.value) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
      const manifest = await this.readManifest(entry.path);
      if (!manifest.ok) {
        damaged++;
        continue;
      }
      const archive = await this.ports.files.stat(this.file(paths, manifest.value.id, ARCHIVE_EXT));
      if (!archive.ok || !archive.value) {
        damaged++;
        continue;
      }
      const plugins = manifest.value.includesPluginFolders
        ? await this.ports.files.stat(this.file(paths, manifest.value.id, PLUGINS_EXT))
        : undefined;
      backups.push({
        ...manifest.value,
        bytes: archive.value.size + (plugins?.ok && plugins.value ? plugins.value.size : 0),
      });
    }
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return ok({ backups, damaged });
  }

  private async readManifest(file: string): Promise<Result<BackupManifest>> {
    const text = await this.ports.files.readText(file);
    if (!text.ok) return text;
    try {
      const parsed = BackupManifestSchema.safeParse(JSON.parse(text.value));
      if (parsed.success) return ok(parsed.data);
      return err(
        'streamDeck.backupDamaged',
        'A backup manifest is damaged.',
        z.prettifyError(parsed.error)
      );
    } catch (e) {
      return err('streamDeck.backupDamaged', 'A backup manifest is damaged.', String(e));
    }
  }

  async get(id: string): Promise<Result<Backup>> {
    const all = await this.list();
    if (!all.ok) return all;
    const found = all.value.backups.find((b) => b.id === id);
    return found ? ok(found) : err('streamDeck.noBackup', 'That backup no longer exists.');
  }

  private async newId(paths: StreamDeckPaths): Promise<string> {
    const base = stamp(this.ports.clock.now());
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!(await this.ports.files.exists(this.file(paths, id, '.json')))) return id;
    }
  }

  private async save(
    paths: StreamDeckPaths,
    manifest: BackupManifest,
    archive: Uint8Array,
    plugins?: Uint8Array
  ): Promise<Result<Backup>> {
    const reason = 'Stream Deck backup';
    const written = await this.ports.files.write(
      this.file(paths, manifest.id, ARCHIVE_EXT),
      archive,
      { reason }
    );
    if (!written.ok) return written;
    if (plugins) {
      const p = await this.ports.files.write(this.file(paths, manifest.id, PLUGINS_EXT), plugins, {
        reason,
      });
      if (!p.ok) return p;
    }
    // The manifest goes last: a backup is only listed once all of it is on disk.
    const m = await this.ports.files.write(
      this.file(paths, manifest.id, '.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { reason }
    );
    if (!m.ok) return m;
    return this.get(manifest.id);
  }

  /** A stable copy of the profiles folder: copied again when Stream Deck wrote during the copy. */
  private async snapshot(
    profilesDir: string
  ): Promise<Result<{ entries: ZipEntry[]; manifests: ManifestFile[] }>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.ports.files.listTree(profilesDir);
      if (!before.ok) return before;
      const entries: ZipEntry[] = [];
      const manifests: ManifestFile[] = [];
      let vanished = false;
      for (const file of before.value) {
        const bytes = await this.ports.files.readBytes(file.path);
        if (!bytes.ok) {
          vanished = true;
          break;
        }
        entries.push({ path: `Profiles/${file.relativePath}`, data: bytes.value });
        if (/(^|\/)manifest\.json$/i.test(file.relativePath)) {
          manifests.push({ path: file.relativePath, text: new TextDecoder().decode(bytes.value) });
        }
      }
      if (vanished) continue;
      const after = await this.ports.files.listTree(profilesDir);
      if (!after.ok) return after;
      if (sameTree(before.value, after.value)) return ok({ entries, manifests });
      await this.sleep(500);
    }
    return err(
      'streamDeck.busy',
      'Stream Deck kept changing its profiles while RigReady copied them.',
      'Try again in a moment.'
    );
  }

  async create(
    options: { name?: string; includePlugins?: boolean; kind?: BackupKind } = {}
  ): Promise<Result<Backup>> {
    const paths = await this.paths();
    const snap = await this.snapshot(paths.profilesDir);
    if (!snap.ok) return snap;
    const parsed = readProfiles(snap.value.manifests);
    if (parsed.profiles.length === 0) {
      return err(
        'streamDeck.noProfiles',
        'There are no Stream Deck profiles on this PC to back up.',
        `Looked in ${paths.profilesDir}.`
      );
    }
    const installed = await readInstalledPlugins(this.ports.files, paths.pluginsDir);
    if (!installed.ok) return installed;
    // Stored in the layout Stream Deck itself uses for that folder: v3 for ProfilesV3, v2 before.
    const archive = createZip(
      paths.profilesV3
        ? [
            ...snap.value.entries,
            { path: 'Resources/manifest.json', data: new TextEncoder().encode(RESOURCES_MANIFEST) },
          ]
        : snap.value.entries.map((e) => ({ ...e, path: e.path.replace(/^Profiles\//, '') }))
    );
    if (!archive.ok) return archive;
    let plugins: Uint8Array | undefined;
    if (options.includePlugins) {
      const zipped = await zipFolder(this.ports.files, paths.pluginsDir);
      if (!zipped.ok) return zipped;
      plugins = zipped.value;
    }
    const status = await detectStreamDeck(this.ports);
    const now = this.ports.clock.now();
    const id = await this.newId(paths);
    const manifest: BackupManifest = {
      schemaVersion: 1,
      id,
      name: options.name?.trim() || `Stream Deck profiles, ${now.toISOString().slice(0, 10)}`,
      createdAt: now.toISOString(),
      kind: options.kind ?? 'manual',
      format: paths.profilesV3 ? 'v3' : 'v2',
      ...(status.ok && status.value.version ? { appVersion: status.value.version } : {}),
      ...summarise(parsed, installed.value),
      plugins: installed.value.map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.version ? { version: p.version } : {}),
      })),
      includesPluginFolders: plugins !== undefined,
    };
    return this.save(paths, manifest, archive.value, plugins);
  }

  async rename(id: string, name: string): Promise<Result<Backup>> {
    const trimmed = name.trim();
    if (!trimmed) return err('streamDeck.name', 'A backup needs a name.');
    const paths = await this.paths();
    const manifest = await this.readManifest(this.file(paths, id, '.json'));
    if (!manifest.ok) return err('streamDeck.noBackup', 'That backup no longer exists.');
    const written = await this.ports.files.write(
      this.file(paths, id, '.json'),
      JSON.stringify({ ...manifest.value, name: trimmed }, null, 2) + '\n',
      { reason: 'Rename Stream Deck backup' }
    );
    if (!written.ok) return written;
    return this.get(id);
  }

  async remove(id: string): Promise<Result<void>> {
    const backup = await this.get(id);
    if (!backup.ok) return backup;
    const paths = await this.paths();
    const reason = 'Delete Stream Deck backup';
    // The manifest goes first, so a half-deleted backup is never listed.
    for (const ext of ['.json', ARCHIVE_EXT, PLUGINS_EXT]) {
      const removed = await this.ports.files.remove(this.file(paths, id, ext), { reason });
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  /** Saves a copy of the backup where the user chooses. Null when they cancelled. */
  async exportTo(id: string): Promise<Result<string | null>> {
    const backup = await this.get(id);
    if (!backup.ok) return backup;
    const paths = await this.paths();
    const target = await this.ports.dialogs.save({
      title: 'Export Stream Deck backup',
      defaultPath: path.join(
        this.ports.folders.documents(),
        `${safeFileName(backup.value.name)}${ARCHIVE_EXT}`
      ),
      filters: [{ name: 'Stream Deck backup', extensions: ['streamDeckProfilesBackup'] }],
    });
    if (!target.ok) return target;
    if (target.value === null) return ok(null);
    const copied = await this.ports.files.copy(this.file(paths, id, ARCHIVE_EXT), target.value, {
      reason: `Export Stream Deck backup "${backup.value.name}"`,
    });
    if (!copied.ok) return copied;
    if (!(await this.ports.files.exists(target.value))) {
      return err('streamDeck.export', 'The exported file is not there.', target.value);
    }
    return ok(target.value);
  }

  /** Stream Deck's own automatic backups (BackupV3), newest first. */
  async elgatoBackups(): Promise<Result<ElgatoBackup[]>> {
    const paths = await this.paths();
    const entries = await this.ports.files.listEntries(paths.elgatoBackupsDir);
    if (!entries.ok) return entries;
    return ok(
      entries.value
        .filter((e) => !e.isDirectory && ELGATO_FILE.test(e.name))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((e) => ({
          fileName: e.name,
          modifiedAt: new Date(e.mtimeMs).toISOString(),
          bytes: e.size,
        }))
    );
  }

  async importElgato(fileName: string): Promise<Result<Backup>> {
    if (!ELGATO_FILE.test(fileName)) {
      return err('streamDeck.import', 'That is not a Stream Deck backup file name.');
    }
    const paths = await this.paths();
    const file = path.join(paths.elgatoBackupsDir, fileName);
    if (!(await this.ports.files.exists(file))) {
      return err('streamDeck.import', 'That Stream Deck backup is no longer there.', file);
    }
    return this.importPath(file);
  }

  /** Asks for a .streamDeckProfilesBackup file and adds it to the backups. Null when cancelled. */
  async importFile(): Promise<Result<Backup | null>> {
    const picked = await this.ports.dialogs.open({
      title: 'Import a Stream Deck backup',
      defaultPath: this.ports.folders.documents(),
      filters: [{ name: 'Stream Deck backup', extensions: ['streamDeckProfilesBackup'] }],
    });
    if (!picked.ok) return picked;
    const file = picked.value[0];
    if (file === undefined) return ok(null);
    return this.importPath(file);
  }

  private async importPath(file: string): Promise<Result<Backup>> {
    const stat = await this.ports.files.stat(file);
    if (!stat.ok) return stat;
    if (!stat.value) return err('streamDeck.import', 'The file is not there.', file);
    const max = await this.options.maxBytes();
    if (stat.value.size > max) {
      return err(
        'zip.tooBig',
        `The file is larger than ${Math.round(max / (1024 * 1024))} MB.`,
        'The limit is the import size in Settings.'
      );
    }
    const bytes = await this.ports.files.readBytes(file);
    if (!bytes.ok) return bytes;
    const summary = readArchiveManifests(bytes.value, max);
    if (!summary.ok) return summary;
    const parsed = readProfiles(summary.value.manifests);
    if (parsed.profiles.length === 0) {
      return err('streamDeck.archive', 'None of the profiles in this file could be read.');
    }
    const paths = await this.paths();
    const installed = await readInstalledPlugins(this.ports.files, paths.pluginsDir);
    const now = this.ports.clock.now();
    const sourceFile = path.win32.basename(file);
    const manifest: BackupManifest = {
      schemaVersion: 1,
      id: await this.newId(paths),
      name: sourceFile.replace(/\.streamDeckProfilesBackup$/i, ''),
      createdAt: now.toISOString(),
      kind: 'imported',
      format: summary.value.format,
      sourceFile,
      sourceModifiedAt: new Date(stat.value.mtimeMs).toISOString(),
      ...summarise(parsed, installed.ok ? installed.value : []),
      // Stream Deck's own backups do not list plugins.
      plugins: [],
      includesPluginFolders: false,
    };
    return this.save(paths, manifest, bytes.value);
  }

  private async currentProfiles(paths: StreamDeckPaths): Promise<Result<ParsedProfile[]>> {
    const manifests = await readProfileManifests(this.ports.files, paths.profilesDir);
    if (!manifests.ok) return manifests;
    return ok(readProfiles(manifests.value).profiles);
  }

  /**
   * The writes and deletions of a "files" restore: every profile file of the backup, the
   * files a replaced profile no longer has, and (separately) the plugin folders. Reads only;
   * the preview and the restore both use it.
   */
  private async restorePlan(
    paths: StreamDeckPaths,
    backup: Backup,
    replace: { uuid: string }[]
  ): Promise<Result<{ profiles: PlannedWrite[]; plugins: PlannedWrite[] }>> {
    const maxTotalBytes = await this.options.maxBytes();
    const bytes = await this.ports.files.readBytes(this.file(paths, backup.id, ARCHIVE_EXT));
    if (!bytes.ok) return bytes;
    const entries = readZip(bytes.value, { maxTotalBytes, maxEntries: 50_000 });
    if (!entries.ok) return entries;
    const profiles: PlannedWrite[] = [];
    const restored = new Set<string>();
    for (const entry of entries.value) {
      const relative = profileRelativePath(entry.path, 'v3');
      if (!relative) continue;
      restored.add(relative.toLowerCase());
      profiles.push({
        path: path.join(paths.profilesDir, ...relative.split('/')),
        content: entry.data,
      });
    }
    // A replaced profile ends up exactly as in the backup: files it no longer has are removed.
    for (const profile of replace) {
      const dir = path.join(paths.profilesDir, `${profile.uuid}.sdProfile`);
      const tree = await this.ports.files.listTree(dir);
      if (!tree.ok) return tree;
      for (const file of tree.value) {
        const relative = `${profile.uuid}.sdProfile/${file.relativePath}`.toLowerCase();
        if (!restored.has(relative)) profiles.push({ path: file.path, remove: true });
      }
    }
    const plugins: PlannedWrite[] = [];
    if (backup.includesPluginFolders) {
      const pluginBytes = await this.ports.files.readBytes(
        this.file(paths, backup.id, PLUGINS_EXT)
      );
      if (!pluginBytes.ok) return pluginBytes;
      const pluginEntries = readZip(pluginBytes.value, { maxTotalBytes, maxEntries: 50_000 });
      if (!pluginEntries.ok) return pluginEntries;
      for (const entry of pluginEntries.value) {
        plugins.push({
          path: path.join(paths.pluginsDir, ...entry.path.split('/')),
          content: entry.data,
        });
      }
    }
    return ok({ profiles, plugins });
  }

  async preview(id: string): Promise<Result<RestorePreview>> {
    const backup = await this.get(id);
    if (!backup.ok) return backup;
    const paths = await this.paths();
    const current = await this.currentProfiles(paths);
    if (!current.ok) return current;
    const running = await isAppRunning(this.ports);
    if (!running.ok) return running;
    const installed = (await appExe(this.ports)) !== undefined;
    const byUuid = new Map(current.value.map((p) => [p.uuid.toLowerCase(), p]));
    const inBackup = new Set(backup.value.profiles.map((p) => p.uuid.toLowerCase()));
    const method = backup.value.format === 'v3' && paths.profilesV3 ? 'files' : 'app';
    const replace = backup.value.profiles.filter((p) => byUuid.has(p.uuid.toLowerCase()));
    let changes: ChangePreview | undefined;
    let pluginChanges: ChangePreview | undefined;
    if (method === 'files') {
      const plan = await this.restorePlan(paths, backup.value, replace);
      if (!plan.ok) return plan;
      const within = (root: string) => (write: PlannedWrite) =>
        path.relative(root, write.path).replace(/\\/g, '/');
      const described = await changePreview(
        this.ports.files,
        plan.value.profiles,
        within(paths.profilesDir)
      );
      if (!described.ok) return described;
      changes = described.value;
      if (plan.value.plugins.length > 0) {
        const plugins = await changePreview(
          this.ports.files,
          plan.value.plugins,
          within(paths.pluginsDir)
        );
        if (!plugins.ok) return plugins;
        pluginChanges = plugins.value;
      }
    }
    return ok({
      backup: backup.value,
      method,
      ...(method === 'app'
        ? {
            methodReason:
              backup.value.format === 'v2'
                ? 'This backup is in the older Stream Deck format, which the Stream Deck app converts when it imports it.'
                : 'This PC has an older Stream Deck app, which must import the backup itself.',
          }
        : {}),
      add: backup.value.profiles
        .filter((p) => !byUuid.has(p.uuid.toLowerCase()))
        .map((p) => ({ uuid: p.uuid, name: p.name })),
      replace: backup.value.profiles
        .filter((p) => byUuid.has(p.uuid.toLowerCase()))
        .map((p) => ({
          uuid: p.uuid,
          name: p.name,
          currentName: byUuid.get(p.uuid.toLowerCase())!.name,
        })),
      keep: current.value
        .filter((p) => !inBackup.has(p.uuid.toLowerCase()))
        .map((p) => ({ uuid: p.uuid, name: p.name })),
      appRunning: running.value,
      appInstalled: installed,
      ...(changes ? { changes } : {}),
      ...(pluginChanges ? { pluginChanges } : {}),
    });
  }

  async restore(
    id: string,
    options: { closeApp?: boolean; force?: boolean; restorePlugins?: boolean } = {}
  ): Promise<Result<RestoreOutcome>> {
    const preview = await this.preview(id);
    if (!preview.ok) return preview;
    const { backup } = preview.value;
    const paths = await this.paths();
    const current = await this.currentProfiles(paths);
    if (!current.ok) return current;

    if (preview.value.method === 'app')
      return this.restoreWithApp(preview.value, current.value.length > 0);

    let closedApp = false;
    if (preview.value.appRunning) {
      if (!options.closeApp) {
        return err(
          'streamDeck.running',
          'Close the Stream Deck app before restoring.',
          'It keeps profiles in memory and would write over the restored ones when it quits.'
        );
      }
      const closed = await closeApp(this.ports, { force: options.force ?? false });
      if (!closed.ok) return closed;
      closedApp = closed.value.closed;
    }

    // Rule 1: what is there now is kept, as a backup of its own and in the journal.
    let safetyBackupId: string | undefined;
    if (current.value.length > 0) {
      const safety = await this.create({
        name: `Before restoring "${backup.name}"`,
        kind: 'before-restore',
      });
      if (!safety.ok) return safety;
      safetyBackupId = safety.value.id;
    }

    const plan = await this.restorePlan(paths, backup, preview.value.replace);
    if (!plan.ok) return plan;
    const group = this.ports.files.beginGroup(`Restore Stream Deck backup "${backup.name}"`);
    const reason = group.reason;
    const failed = (result: { ok: false; error: { message: string; detail?: string } }) =>
      err(
        'streamDeck.restore',
        `The restore stopped part way: ${result.error.message}`,
        'What was already written can be undone on the Safety page.'
      );
    const planned = [...plan.value.profiles, ...(options.restorePlugins ? plan.value.plugins : [])];
    for (const write of planned) {
      const done =
        'remove' in write
          ? await this.ports.files.remove(write.path, { reason, group })
          : await this.ports.files.write(write.path, write.content, { reason, group });
      if (!done.ok) return failed(done);
    }

    // Read it back: success only when every profile of the backup is there under its name.
    const after = await this.currentProfiles(paths);
    if (!after.ok) return after;
    const missing = backup.profiles.filter(
      (p) =>
        !after.value.some((a) => a.uuid.toLowerCase() === p.uuid.toLowerCase() && a.name === p.name)
    );
    if (missing.length > 0) {
      return err(
        'streamDeck.verify',
        `After the restore, ${missing.length} profile${missing.length === 1 ? ' is' : 's are'} not there: ${missing.map((m) => m.name).join(', ')}.`,
        'The restore can be undone on the Safety page.'
      );
    }
    return ok({
      method: 'files',
      groupId: group.id,
      restored: backup.profiles.length,
      ...(safetyBackupId ? { safetyBackupId } : {}),
      closedApp,
      expected: backup.profiles.map((p) => p.name),
    });
  }

  /** Hands the file to the Stream Deck app, which shows its own "Restore?" prompt. */
  private async restoreWithApp(
    preview: RestorePreview,
    hasProfiles: boolean
  ): Promise<Result<RestoreOutcome>> {
    const exe = await appExe(this.ports);
    if (!exe) {
      return err(
        'streamDeck.notInstalled',
        'Install the Stream Deck app first: this backup is restored by the app itself.'
      );
    }
    let safetyBackupId: string | undefined;
    if (hasProfiles) {
      const safety = await this.create({
        name: `Before restoring "${preview.backup.name}"`,
        kind: 'before-restore',
      });
      if (!safety.ok) return safety;
      safetyBackupId = safety.value.id;
    }
    const paths = await this.paths();
    const started = await this.ports.processes.start({
      exe,
      args: [this.file(paths, preview.backup.id, ARCHIVE_EXT)],
    });
    if (!started.ok) return started;
    return ok({
      method: 'app',
      restored: 0,
      ...(safetyBackupId ? { safetyBackupId } : {}),
      closedApp: false,
      expected: preview.backup.profiles.map((p) => p.name),
    });
  }

  /** After an app restore: which of the backup's profiles the Stream Deck app now has. */
  async verifyAppRestore(id: string): Promise<Result<{ found: string[]; missing: string[] }>> {
    const backup = await this.get(id);
    if (!backup.ok) return backup;
    const current = await this.currentProfiles(await this.paths());
    if (!current.ok) return current;
    const names = new Set(current.value.map((p) => p.name));
    const expected = backup.value.profiles.map((p) => p.name);
    return ok({
      found: expected.filter((n) => names.has(n)),
      missing: expected.filter((n) => !names.has(n)),
    });
  }

  /** Puts back what a file restore changed. The app must be closed, as for the restore. */
  async undoRestore(groupId: string, options: { force?: boolean } = {}): Promise<Result<void>> {
    const running = await isAppRunning(this.ports);
    if (!running.ok) return running;
    if (running.value) {
      return err(
        'streamDeck.running',
        'Close the Stream Deck app before undoing the restore.',
        'It would write over the profiles again when it quits.'
      );
    }
    const undone = await this.ports.files.undoGroup(groupId, options);
    if (!undone.ok) return undone;
    return ok(undefined);
  }
}
