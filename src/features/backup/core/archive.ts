import path from 'node:path';
import { unzipSync } from 'fflate';
import { loadDataYaml } from '../../../core/files/yaml';
import { z } from 'zod';
import { sha256 } from '../../../core/files/fileStore';
import { createZipInSteps, readZip, type ZipEntry } from '../../../core/files/zip';
import { inspectZip } from '../../../core/files/zipInspect';
import { collapsePath, variableOf } from '../../../core/pathVariables';
import { err, ok, type Result } from '../../../core/result';
import { resolveTrackedItem, TrackedItemSchema, type TrackedItem } from '../../../core/tracked';
import { blobRelativePath } from './blobs';
import { FingerprintFileSchema } from './fingerprints';
import { cleanValues } from './records';
import { SnapshotIndexSchema } from './snapshots';
import { collectSuggestions } from './suggestions';
import {
  allScopes,
  backupRoot,
  indexStore,
  itemsOf,
  pathVariables,
  prefsStore,
  type Ctx,
  type MachineIdentity,
} from './store';

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const ManifestFileSchema = z.object({
  /** Below the item's folder, forward slashes. */
  path: z.string().min(1).max(1024),
  size: z.number().int().min(0),
  sha256: Sha,
});

export const ManifestItemSchema = TrackedItemSchema.extend({
  /** Folder of this item's files inside the archive: items/<key>/. */
  key: z.string().regex(/^[0-9]{1,5}$/),
  /** ALWAYS or the profile id the item was tracked in, and its name then. */
  source: z.string().max(80),
  sourceName: z.string().max(120),
  /** True when the path is stored without a path variable (it may not exist on another PC). */
  absolute: z.boolean(),
  /** True when nothing was there when the backup was made. */
  missing: z.boolean().default(false),
  files: z.array(ManifestFileSchema).max(20_000),
});
export type ManifestItem = z.infer<typeof ManifestItemSchema>;

/**
 * RigReady's own files in a backup, by path below the data root: setups, settings, layouts,
 * the "Always back up" list, the snapshots and "what changed" indexes, and the stored
 * copies of the files those two refer to (named by their content).
 */
export const RIGREADY_FILES =
  /^(profiles\/[a-z0-9][a-z0-9-]{0,63}\.yaml|settings\.json|displays\/layouts\.json|backup\/(tracked|snapshots|fingerprints)\.json|backup\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64})$/;

/** The snapshots index and the "what changed" records, below the data root. */
export const SNAPSHOTS_FILE = 'backup/snapshots.json';
export const FINGERPRINTS_FILE = 'backup/fingerprints.json';

const BLOB_FILE = /^backup\/blobs\/([0-9a-f]{2})\/([0-9a-f]{64})$/;

export const ManifestSchema = z.object({
  format: z.literal('rigready-backup'),
  schemaVersion: z.literal(1),
  createdAt: z.string().max(40),
  machine: z.string().max(200),
  user: z.string().max(200),
  appVersion: z.string().max(50),
  scope: z.object({
    kind: z.enum(['full', 'profile', 'custom', 'before-restore']),
    label: z.string().max(200),
    profileIds: z.array(z.string().max(80)).max(500).default([]),
  }),
  items: z.array(ManifestItemSchema).max(1000),
  rigready: z
    .array(ManifestFileSchema.extend({ path: z.string().regex(RIGREADY_FILES) }))
    .max(50_000),
  /**
   * Settings that are not files (registry values), kept as data under records/. They can
   * be read back; nothing restores them.
   */
  records: z
    .array(
      ManifestFileSchema.extend({
        path: z.string().regex(/^[a-z0-9][a-z0-9-]{0,120}\.json$/),
        label: z.string().max(120),
        /** Where it was read: "HKEY_CURRENT_USER\\Software\\Endor\\FanatecService". */
        from: z.string().max(400),
        source: z.string().max(80),
        /** One row per stored value, as the source describes them (optional). */
        values: z
          .array(
            z.object({
              group: z.string().max(200).optional(),
              label: z.string().max(200),
              name: z.string().max(200).optional(),
              value: z.string().max(400),
            })
          )
          .max(2000)
          .optional(),
      })
    )
    .max(200)
    .default([]),
  /** Files that could not be read when the backup was made. */
  skipped: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .max(20_000)
    .default([]),
  /** Files left out because they hold credentials. */
  withheld: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .max(20_000)
    .default([]),
  totals: z.object({ files: z.number().int().min(0), bytes: z.number().int().min(0) }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export type BackupScope =
  | { kind: 'full' }
  | { kind: 'profile'; profileId: string }
  | { kind: 'custom'; label: string; items: { scope: string; id: string }[] }
  /** Everything known about one game: what the user tracks for it and what its module suggests. */
  | { kind: 'game'; gameId: string };

export interface BackupView {
  id: string;
  name: string;
  createdAt: string;
  machine: string;
  appVersion: string;
  scopeKind: Manifest['scope']['kind'];
  scopeLabel: string;
  /** Size of the archive on disk. */
  size: number;
  fileCount: number;
  totalBytes: number;
  items: { label: string; game?: string; fileCount: number; sourceName: string }[];
  /** Settings kept as data (registry values): readable, never restored. */
  records: { label: string; from: string }[];
  /** The setups in the backup, by name (as they were called when it was made). */
  profiles: string[];
  /** The snapshots in the backup, by name. */
  snapshots: string[];
  /** The setups whose "what changed" record is in the backup, by name. */
  changeRecords: string[];
  imported: boolean;
  /** Set when the file is not a readable RigReady backup. */
  damaged?: string;
}

export interface BackupOutcome {
  backup: BackupView;
  skipped: { path: string; reason: string }[];
  withheld: { path: string; reason: string }[];
  /** Older backups removed by the retention setting. */
  pruned: string[];
}

/** A backup is built in memory: this keeps it well inside what the app can hold. */
export const MAX_BACKUP_BYTES = 2 * 1024 ** 3;

export type Progress = (p: { done: number; total: number; label: string }) => void;

/**
 * Whether the user stopped the backup: asked before each file is read and before each is
 * compressed. Nothing has been written when it stops, so there is nothing to clean up.
 */
export type Cancelled = () => boolean;

const cancelledResult = (): Result<never> =>
  err('backup.cancelled', 'The backup was cancelled. Nothing was written.');

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

export function cleanName(name: string): string {
  return name
    .replace(BAD_NAME, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
}

/** A backup id is a .zip file name directly in the backups folder. */
export function backupFile(ctx: Pick<Ctx, 'ports'>, id: string): Result<string> {
  if (!/^[^\\/:*?"<>|\u0000-\u001f]{1,150}\.zip$/i.test(id) || id.startsWith('.')) {
    return err('backup.id', `Not a backup name: ${id}`);
  }
  return ok(path.join(backupRoot(ctx), id));
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function stampOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}`;
}

async function uniqueId(ctx: Pick<Ctx, 'ports'>, base: string): Promise<string> {
  let id = `${base}.zip`;
  for (let n = 2; await ctx.ports.files.exists(path.join(backupRoot(ctx), id)); n++) {
    id = `${base} (${n}).zip`;
  }
  return id;
}

interface Collected {
  manifest: Manifest;
  entries: ZipEntry[];
}

interface ItemRef {
  source: string;
  sourceName: string;
  item: TrackedItem;
}

const sameRef = (a: TrackedItem, b: TrackedItem): boolean =>
  a.path.toLowerCase() === b.path.toLowerCase() &&
  a.kind === b.kind &&
  a.include.join('|').toLowerCase() === b.include.join('|').toLowerCase() &&
  a.exclude.join('|').toLowerCase() === b.exclude.join('|').toLowerCase();

async function rigreadyFiles(
  ctx: Ctx,
  scope: BackupScope
): Promise<Result<{ path: string; data: Uint8Array }[]>> {
  const root = ctx.ports.folders.dataRoot();
  const wanted: string[] = [];
  if (scope.kind === 'full') {
    const names = await ctx.ports.files.list(path.join(root, 'profiles'));
    if (!names.ok) return names;
    for (const name of names.value.sort()) {
      if (RIGREADY_FILES.test(`profiles/${name}`)) wanted.push(`profiles/${name}`);
    }
    wanted.push('settings.json', 'displays/layouts.json', 'backup/tracked.json');
  } else if (scope.kind === 'profile') {
    wanted.push(`profiles/${scope.profileId}.yaml`);
  }
  const out: { path: string; data: Uint8Array }[] = [];
  for (const relative of wanted) {
    const file = path.join(root, ...relative.split('/'));
    if (!(await ctx.ports.files.exists(file))) continue;
    const bytes = await ctx.ports.files.readBytes(file);
    if (!bytes.ok) return bytes;
    out.push({ path: relative, data: bytes.value });
  }
  return ok(out);
}

interface HistoryPlan {
  /** The snapshots index and the "what changed" records, as they are on disk. */
  indexes: { path: string; data: Uint8Array }[];
  /** Every stored copy the indexes refer to that is on disk: its archive path, file and size. */
  blobs: { path: string; file: string; size: number }[];
  /** An index that could not be read, and every stored copy that is gone. */
  skipped: { path: string; reason: string }[];
}

const emptyHistory = (): HistoryPlan => ({ indexes: [], blobs: [], skipped: [] });

type ReadIndex<S extends z.ZodType> =
  { data: Uint8Array; parsed: z.output<S> } | { problem: string } | undefined;

/** One of the two indexes, as it is on disk and parsed; undefined when there is none. */
async function readIndex<S extends z.ZodType>(
  ctx: Ctx,
  relative: string,
  schema: S
): Promise<ReadIndex<S>> {
  const file = path.join(ctx.ports.folders.dataRoot(), ...relative.split('/'));
  if (!(await ctx.ports.files.exists(file))) return undefined;
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) return { problem: bytes.error.detail ?? bytes.error.message };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes.value));
  } catch (e) {
    // Reported: the backup lists the index as skipped with this reason.
    return { problem: `The file is not valid JSON: ${String(e)}` };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { problem: 'The file is not valid.' };
  return { data: bytes.value, parsed: parsed.data };
}

/**
 * The snapshots and the "what changed" records of this PC with the stored copies of their
 * files: listed and sized, not read, so the size limit is checked before anything is read.
 * A damaged index is left out and reported, and so is a stored copy that is gone.
 */
async function planHistory(ctx: Ctx): Promise<HistoryPlan> {
  const plan = emptyHistory();
  /** Content id -> what refers to it, for the report when the copy is gone. */
  const owners = new Map<string, string>();
  const snapshots = await readIndex(ctx, SNAPSHOTS_FILE, SnapshotIndexSchema);
  if (snapshots && 'problem' in snapshots) {
    plan.skipped.push({ path: SNAPSHOTS_FILE, reason: snapshots.problem });
  } else if (snapshots) {
    plan.indexes.push({ path: SNAPSHOTS_FILE, data: snapshots.data });
    for (const s of snapshots.parsed.snapshots) {
      for (const f of s.files) {
        if (!owners.has(f.sha256)) owners.set(f.sha256, `snapshot "${s.name}", ${f.path}`);
      }
    }
  }
  const records = await readIndex(ctx, FINGERPRINTS_FILE, FingerprintFileSchema);
  if (records && 'problem' in records) {
    plan.skipped.push({ path: FINGERPRINTS_FILE, reason: records.problem });
  } else if (records) {
    plan.indexes.push({ path: FINGERPRINTS_FILE, data: records.data });
    for (const [profileId, record] of Object.entries(records.parsed.profiles)) {
      for (const f of record.files) {
        if (f.stored && !owners.has(f.sha256)) {
          owners.set(f.sha256, `the "what changed" record of ${profileId}, ${f.key}`);
        }
      }
    }
  }
  const root = ctx.ports.folders.dataRoot();
  for (const [hash, owner] of owners) {
    const relative = blobRelativePath(hash);
    const file = path.join(root, ...relative.split('/'));
    const stat = await ctx.ports.files.stat(file);
    if (!stat.ok || !stat.value) {
      plan.skipped.push({ path: file, reason: `The stored copy is missing (${owner}).` });
      continue;
    }
    plan.blobs.push({ path: relative, file, size: stat.value.size });
  }
  return plan;
}

async function itemRefs(ctx: Ctx, scope: BackupScope): Promise<Result<ItemRef[]>> {
  const scopes = await allScopes(ctx);
  if (!scopes.ok) return scopes;
  const refs: ItemRef[] = [];
  const add = (source: string, item: TrackedItem): void => {
    if (refs.some((r) => sameRef(r.item, item))) return;
    const sourceName = scopes.value.find((s) => s.id === source)?.name ?? source;
    refs.push({ source, sourceName, item });
  };
  if (scope.kind === 'full') {
    for (const s of scopes.value) for (const item of s.items) add(s.id, item);
  } else if (scope.kind === 'profile') {
    const own = await itemsOf(ctx, scope.profileId);
    if (!own.ok) return own;
    for (const item of own.value) add(scope.profileId, item);
  } else if (scope.kind === 'game') {
    const name = ctx.games.get(scope.gameId)?.name ?? scope.gameId;
    for (const s of scopes.value)
      for (const item of s.items) if (item.game === scope.gameId) add(s.id, item);
    // Folders before single files, so a file a folder already covers is not stored twice.
    const suggested = (await collectSuggestions(ctx, []))
      .filter((s) => s.game === scope.gameId)
      .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder'));
    for (const [n, s] of suggested.entries()) {
      const item: TrackedItem = {
        id: `suggested-${n}`,
        label: s.label,
        path: s.path,
        kind: s.kind,
        include: s.include ?? [],
        exclude: s.exclude ?? [],
        game: scope.gameId,
      };
      if (!refs.some((r) => sameRef(r.item, item)))
        refs.push({ source: `game:${scope.gameId}`, sourceName: name, item });
    }
  } else {
    for (const ref of scope.items) {
      const item = scopes.value.find((s) => s.id === ref.scope)?.items.find((i) => i.id === ref.id);
      if (!item) return err('backup.noItem', 'A chosen item is no longer tracked.');
      add(ref.scope, item);
    }
  }
  return ok(refs);
}

/** Reads everything a backup of `scope` contains into memory, with the manifest. */
async function collect(
  ctx: Ctx,
  scope: BackupScope,
  label: string,
  identity: MachineIdentity,
  appVersion: string,
  onProgress?: Progress,
  cancelled?: Cancelled
): Promise<Result<Collected>> {
  const variables = await pathVariables(ctx);
  const refs = await itemRefs(ctx, scope);
  if (!refs.ok) return refs;
  const own = await rigreadyFiles(ctx, scope);
  if (!own.ok) return own;
  const resolved = [];
  const seen = new Set<string>();
  for (const ref of refs.value) {
    const r = await resolveTrackedItem(ctx.ports.files, ref.item, variables);
    if (scope.kind === 'game') {
      // A game's suggestions overlap (the whole folder, then its files one by one).
      const fresh = r.files.filter((f) => !seen.has(f.path.toLowerCase()));
      if (r.files.length > 0 && fresh.length === 0) continue;
      for (const f of r.files) seen.add(f.path.toLowerCase());
    }
    resolved.push({ ref, resolved: r });
  }
  const records = scope.kind === 'full' ? await collectRecords(ctx) : [];
  const history = scope.kind === 'full' ? await planHistory(ctx) : emptyHistory();
  const total =
    resolved.reduce((sum, r) => sum + r.resolved.files.length, 0) +
    own.value.length +
    history.indexes.length +
    history.blobs.length;
  // The archive is built in memory; refuse before reading anything rather than run out of it.
  const trackedBytes = resolved.reduce(
    (sum, r) => sum + r.resolved.files.reduce((s, f) => s + f.size, 0),
    0
  );
  const storedBytes = history.blobs.reduce((sum, b) => sum + b.size, 0);
  const planned = trackedBytes + storedBytes;
  if (planned > MAX_BACKUP_BYTES) {
    const biggest = [...resolved].sort(
      (a, b) =>
        b.resolved.files.reduce((s, f) => s + f.size, 0) -
        a.resolved.files.reduce((s, f) => s + f.size, 0)
    )[0];
    const gb = (n: number): string => (n / 1024 ** 3).toFixed(1);
    const what =
      storedBytes > 0
        ? 'The tracked files and the stored copies of snapshots and records'
        : 'The tracked files';
    const largest = biggest
      ? ` The largest is "${biggest.ref.item.label}": leave its big folders out with patterns${storedBytes > 0 ? ', or delete snapshots you no longer need' : ''}.`
      : ' Delete snapshots you no longer need.';
    const stored =
      storedBytes > 0 ? ` Snapshots and records hold ${gb(storedBytes)} GB of that.` : '';
    return err(
      'backup.tooBig',
      `${what} add up to ${gb(planned)} GB, more than one backup can hold (${MAX_BACKUP_BYTES / 1024 ** 3} GB).${stored}${largest}`
    );
  }
  let done = 0;
  const entries: ZipEntry[] = [];
  const items: ManifestItem[] = [];
  const skipped: Manifest['skipped'] = [];
  const withheld: Manifest['withheld'] = [];
  let bytes = 0;
  for (const [index, { ref, resolved: r }] of resolved.entries()) {
    const key = String(index);
    const files: ManifestItem['files'] = [];
    for (const w of r.withheld) {
      withheld.push({ path: `${ref.item.path}/${w.relativePath}`, reason: w.reason });
    }
    if (r.problem && r.files.length === 0 && r.absolute === undefined) {
      skipped.push({ path: ref.item.path, reason: r.problem });
    }
    for (const file of r.files) {
      if (cancelled?.()) return cancelledResult();
      onProgress?.({ done: done++, total, label: ref.item.label });
      const data = await ctx.ports.files.readBytes(file.path);
      if (!data.ok) {
        skipped.push({ path: file.path, reason: data.error.detail ?? data.error.message });
        continue;
      }
      entries.push({ path: `items/${key}/${file.relativePath}`, data: data.value });
      files.push({ path: file.relativePath, size: data.value.length, sha256: sha256(data.value) });
      bytes += data.value.length;
    }
    // A path the user typed without a variable is collapsed now if one covers it.
    const stored = variableOf(ref.item.path)
      ? ref.item.path
      : collapsePath(ref.item.path, variables);
    items.push({
      ...ref.item,
      path: stored,
      key,
      source: ref.source,
      sourceName: ref.sourceName,
      absolute: !variableOf(stored),
      missing: !r.exists,
      files,
    });
  }
  const rigready: Manifest['rigready'] = [];
  for (const file of own.value) {
    onProgress?.({ done: done++, total, label: 'RigReady setups and settings' });
    entries.push({ path: `rigready/${file.path}`, data: file.data });
    rigready.push({ path: file.path, size: file.data.length, sha256: sha256(file.data) });
    bytes += file.data.length;
  }
  // The snapshots and "what changed" records travel as they are on disk: the two indexes
  // and the stored copies of the files they refer to, each named by its content.
  for (const index of history.indexes) {
    onProgress?.({ done: done++, total, label: 'Snapshots and "what changed" records' });
    entries.push({ path: `rigready/${index.path}`, data: index.data });
    rigready.push({ path: index.path, size: index.data.length, sha256: sha256(index.data) });
    bytes += index.data.length;
  }
  for (const blob of history.blobs) {
    if (cancelled?.()) return cancelledResult();
    onProgress?.({ done: done++, total, label: 'Stored copies of snapshot and record files' });
    const data = await ctx.ports.files.readBytes(blob.file);
    if (!data.ok) {
      skipped.push({ path: blob.file, reason: data.error.detail ?? data.error.message });
      continue;
    }
    const hash = sha256(data.value);
    if (!blob.path.endsWith(hash)) {
      skipped.push({ path: blob.file, reason: 'The stored copy does not match its name.' });
      continue;
    }
    entries.push({ path: `rigready/${blob.path}`, data: data.value });
    rigready.push({ path: blob.path, size: data.value.length, sha256: hash });
    bytes += data.value.length;
  }
  skipped.push(...history.skipped);
  const recorded: Manifest['records'] = [];
  for (const record of records) {
    entries.push({ path: `records/${record.path}`, data: record.data });
    recorded.push({
      path: record.path,
      size: record.data.length,
      sha256: sha256(record.data),
      label: record.label,
      from: record.from,
      source: record.source,
      ...(record.values ? { values: record.values } : {}),
    });
  }
  onProgress?.({ done: total, total, label: 'Writing the backup' });
  const manifest: Manifest = {
    format: 'rigready-backup',
    schemaVersion: 1,
    createdAt: ctx.ports.clock.now().toISOString(),
    machine: identity.machine,
    user: identity.users[0] ?? '',
    appVersion,
    scope: {
      kind: scope.kind === 'game' ? 'custom' : scope.kind,
      label,
      profileIds:
        scope.kind === 'profile'
          ? [scope.profileId]
          : own.value
              .filter((f) => f.path.startsWith('profiles/'))
              .map((f) => f.path.slice('profiles/'.length, -'.yaml'.length)),
    },
    items,
    rigready,
    records: recorded,
    skipped,
    withheld,
    // Records are listed on their own: the totals are the files that can be restored.
    totals: { files: entries.length - recorded.length, bytes },
  };
  return ok({ manifest, entries });
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'record';

interface CollectedRecord {
  path: string;
  label: string;
  from: string;
  source: string;
  data: Uint8Array;
  values?: NonNullable<Manifest['records'][number]['values']>;
}

/** What backup sources keep outside files (registry values), as JSON to store in a full backup. */
async function collectRecords(ctx: Ctx): Promise<CollectedRecord[]> {
  const out: CollectedRecord[] = [];
  for (const source of ctx.backupSources.all()) {
    if (!source.records) continue;
    try {
      const found = await source.records(ctx);
      if (!found.ok) {
        ctx.log.warn(`records of ${source.id}: ${found.error.message}`);
        continue;
      }
      for (const record of found.value) {
        let name = `${slug(source.id)}-${slug(record.id)}.json`;
        for (let n = 2; out.some((o) => o.path === name); n++)
          name = `${slug(source.id)}-${slug(record.id)}-${n}.json`;
        out.push({
          path: name,
          label: record.label.slice(0, 120),
          from: record.from.slice(0, 400),
          source: source.label.slice(0, 80),
          data: new TextEncoder().encode(JSON.stringify(record.data, null, 2) + '\n'),
          ...(record.values?.length ? { values: cleanValues(record.values) } : {}),
        });
      }
    } catch (e) {
      ctx.log.error(`records of ${source.id} threw`, e);
    }
  }
  return out;
}

async function scopeLabel(ctx: Ctx, scope: BackupScope): Promise<Result<string>> {
  if (scope.kind === 'full') return ok('Everything');
  if (scope.kind === 'custom') return ok(scope.label.trim() || 'Selected items');
  if (scope.kind === 'game') {
    const module = ctx.games.get(scope.gameId);
    return module
      ? ok(`${module.name} files`)
      : err('backup.game', `This version of RigReady does not know the game "${scope.gameId}".`);
  }
  const profile = await ctx.profiles.get(scope.profileId);
  return profile.ok ? ok(profile.value.name) : profile;
}

/** Writes an archive (manifest + files) into the backups folder. */
export async function writeArchive(
  ctx: Ctx,
  manifest: Manifest,
  entries: ZipEntry[],
  baseName: string,
  cancelled?: Cancelled
): Promise<Result<string>> {
  // File by file, so the app keeps answering while a big backup is compressed.
  const zipped = await createZipInSteps(
    [
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ...entries,
    ],
    cancelled ? { cancelled } : {}
  );
  if (!zipped.ok) return zipped.error.code === 'zip.cancelled' ? cancelledResult() : zipped;
  const id = await uniqueId(ctx, cleanName(baseName));
  const file = path.join(backupRoot(ctx), id);
  const written = await ctx.ports.files.write(file, zipped.value, { reason: 'Backup' });
  if (!written.ok) return written;
  const stat = await ctx.ports.files.stat(file);
  if (!stat.ok || stat.value?.size !== zipped.value.length) {
    return err('backup.write', `The backup could not be written to ${file}.`);
  }
  return ok(id);
}

export async function createBackup(
  ctx: Ctx,
  scope: BackupScope,
  options: {
    identity: MachineIdentity;
    appVersion: string;
    onProgress?: Progress;
    /** True once the user asked to stop: the backup ends with `backup.cancelled`. */
    cancelled?: Cancelled;
  }
): Promise<Result<BackupOutcome>> {
  const label = await scopeLabel(ctx, scope);
  if (!label.ok) return label;
  const collected = await collect(
    ctx,
    scope,
    label.value,
    options.identity,
    options.appVersion,
    options.onProgress,
    options.cancelled
  );
  if (!collected.ok) return collected;
  const { manifest, entries } = collected.value;
  if (manifest.totals.files === 0) {
    return err(
      'backup.empty',
      scope.kind === 'full'
        ? 'There is nothing to back up yet: no setups and no tracked files.'
        : scope.kind === 'game'
          ? `Nothing to back up: no settings files of ${label.value.replace(/ files$/, '')} were found on this PC.`
          : 'Nothing to back up: the tracked files of this setup do not exist on this PC.'
    );
  }
  const id = await writeArchive(
    ctx,
    manifest,
    entries,
    `${stampOf(ctx.ports.clock.now())} ${label.value}`,
    options.cancelled
  );
  if (!id.ok) return id;
  const pruned = await applyRetention(ctx, id.value);
  const view = await describeBackup(ctx, id.value);
  if (!view.ok) return view;
  ctx.log.info(`backup ${id.value}`, {
    files: manifest.totals.files,
    bytes: manifest.totals.bytes,
  });
  return ok({ backup: view.value, skipped: manifest.skipped, withheld: manifest.withheld, pruned });
}

/** Reads only the manifest of an archive. */
export function readManifest(bytes: Uint8Array): Result<Manifest> {
  let found: Uint8Array | undefined;
  try {
    const unzipped = unzipSync(bytes, {
      filter: (file) => file.name === 'manifest.json' && file.originalSize < 50 * 1024 * 1024,
    });
    found = unzipped['manifest.json'];
  } catch (e) {
    return err('backup.notZip', 'The file is not a readable zip archive.', String(e));
  }
  if (!found) return err('backup.noManifest', 'The file is not a RigReady backup (no manifest).');
  return parseManifest(found);
}

const profileIdOf = (file: string): string => file.slice('profiles/'.length, -'.yaml'.length);

/**
 * What each setup in an archive is called, by id: the name in the setup file the archive
 * holds, so a backup still names a setup that was renamed or deleted since.
 */
function profileNamesIn(bytes: Uint8Array, manifest: Manifest): Map<string, string> {
  const names = new Map<string, string>();
  const wanted = new Set(
    manifest.rigready.filter((f) => f.path.startsWith('profiles/')).map((f) => f.path)
  );
  if (wanted.size === 0) return names;
  try {
    const unzipped = unzipSync(bytes, {
      filter: (file) =>
        file.name.startsWith('rigready/') &&
        wanted.has(file.name.slice('rigready/'.length)) &&
        file.originalSize < 5 * 1024 * 1024,
    });
    for (const [name, data] of Object.entries(unzipped)) {
      try {
        const raw: unknown = loadDataYaml(new TextDecoder().decode(data));
        const given = (raw as { name?: unknown } | null)?.name;
        if (typeof given === 'string' && given.trim())
          names.set(profileIdOf(name.slice('rigready/'.length)), given.trim().slice(0, 120));
      } catch {
        // Not YAML: named by the fallbacks of the caller.
      }
    }
  } catch {
    // Not a readable zip: describeBackup reports that from the manifest.
  }
  return names;
}

/** The setups a backup holds, by name. */
async function profileNames(
  ctx: Ctx,
  stored: Map<string, string>,
  manifest: Manifest
): Promise<string[]> {
  const out: string[] = [];
  for (const file of manifest.rigready.filter((f) => f.path.startsWith('profiles/'))) {
    const id = profileIdOf(file.path);
    let name = stored.get(id);
    if (!name) {
      // The setup file in the backup is unreadable: the setup of that id here, if any.
      const current = await ctx.profiles.get(id);
      name = current.ok ? current.value.name : `Unreadable setup (${id})`;
    }
    out.push(name);
  }
  return out;
}

/** One of the two small indexes inside an archive, parsed; undefined when it is not there or unreadable. */
function indexIn<S extends z.ZodType>(
  bytes: Uint8Array,
  manifest: Manifest,
  relative: string,
  schema: S
): z.output<S> | undefined {
  if (!manifest.rigready.some((f) => f.path === relative)) return undefined;
  try {
    const unzipped = unzipSync(bytes, {
      filter: (file) =>
        file.name === `rigready/${relative}` && file.originalSize < 50 * 1024 * 1024,
    });
    const data = unzipped[`rigready/${relative}`];
    if (!data) return undefined;
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(data)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not a readable zip or not JSON: the backup is described without this list.
    return undefined;
  }
}

/** The snapshots and the setups with a "what changed" record a backup holds, by name. */
async function historyNames(
  ctx: Ctx,
  bytes: Uint8Array,
  stored: Map<string, string>,
  manifest: Manifest
): Promise<{ snapshots: string[]; changeRecords: string[] }> {
  const snapshots = indexIn(bytes, manifest, SNAPSHOTS_FILE, SnapshotIndexSchema);
  const records = indexIn(bytes, manifest, FINGERPRINTS_FILE, FingerprintFileSchema);
  const changeRecords: string[] = [];
  for (const id of Object.keys(records?.profiles ?? {})) {
    let name = stored.get(id);
    if (!name) {
      const current = await ctx.profiles.get(id);
      name = current.ok ? current.value.name : id;
    }
    changeRecords.push(name);
  }
  return { snapshots: (snapshots?.snapshots ?? []).map((s) => s.name), changeRecords };
}

function parseManifest(bytes: Uint8Array): Result<Manifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return err('backup.manifest', 'The backup manifest is not valid JSON.', String(e));
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      'backup.manifest',
      'The backup manifest is not valid.',
      z.prettifyError(parsed.error)
    );
  }
  return ok(parsed.data);
}

export interface OpenedArchive {
  manifest: Manifest;
  /** Archive path -> content, every one verified against the manifest. */
  data: Map<string, Uint8Array>;
}

/**
 * Opens a backup archive as untrusted input: size limits, no links, no unsafe names,
 * a valid manifest, nothing in the archive that the manifest does not list, and every
 * file matching its checksum. Nothing is written.
 */
export async function openArchive(ctx: Ctx, file: string): Promise<Result<OpenedArchive>> {
  const settings = await ctx.settings.get();
  const maxTotalBytes = (settings.ok ? settings.value.importMaxMegabytes : 200) * 1024 * 1024;
  const stat = await ctx.ports.files.stat(file);
  if (!stat.ok) return stat;
  if (!stat.value) return err('backup.missing', `The backup file is gone: ${file}`);
  if (stat.value.size > maxTotalBytes) {
    return err('zip.tooBig', `The backup is larger than ${maxTotalBytes / (1024 * 1024)} MB.`);
  }
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) return bytes;
  const inspected = inspectZip(bytes.value, { maxTotalBytes });
  if (!inspected.ok) return inspected;
  const entries = readZip(bytes.value, { maxTotalBytes });
  if (!entries.ok) return entries;
  const manifestEntry = entries.value.find((e) => e.path === 'manifest.json');
  if (!manifestEntry) {
    return err('backup.noManifest', 'The file is not a RigReady backup (no manifest).');
  }
  const manifest = parseManifest(manifestEntry.data);
  if (!manifest.ok) return manifest;
  const declared = new Map<string, string>();
  const keys = new Set<string>();
  for (const item of manifest.value.items) {
    if (keys.has(item.key))
      return err('backup.manifest', 'The backup manifest lists an item twice.');
    keys.add(item.key);
    if (item.kind === 'file' && item.files.length > 1) {
      return err(
        'backup.manifest',
        `"${item.label}" is a single file but the backup holds several.`
      );
    }
    for (const f of item.files) declared.set(`items/${item.key}/${f.path}`, f.sha256);
  }
  for (const f of manifest.value.rigready) {
    // A stored copy is found again by its name, so the name must be the content's hash.
    const blob = BLOB_FILE.exec(f.path);
    if (blob && (f.sha256 !== blob[2] || blob[1] !== blob[2]!.slice(0, 2))) {
      return err(
        'backup.manifest',
        'A stored copy of a snapshot or record file in the backup is not named by its content.'
      );
    }
    declared.set(`rigready/${f.path}`, f.sha256);
  }
  for (const f of manifest.value.records) declared.set(`records/${f.path}`, f.sha256);
  const data = new Map<string, Uint8Array>();
  for (const entry of entries.value) {
    if (entry.path === 'manifest.json') continue;
    const hash = declared.get(entry.path);
    if (!hash)
      return err(
        'backup.unexpected',
        `The backup holds a file its manifest does not list: ${entry.path}`
      );
    if (sha256(entry.data) !== hash)
      return err('backup.damaged', `A file in the backup is damaged: ${entry.path}`);
    data.set(entry.path, entry.data);
  }
  for (const name of declared.keys()) {
    if (!data.has(name)) return err('backup.damaged', `A file is missing from the backup: ${name}`);
  }
  return ok({ manifest: manifest.value, data });
}

const viewCache = new Map<string, { key: string; view: BackupView }>();

export async function describeBackup(ctx: Ctx, id: string): Promise<Result<BackupView>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  const stat = await ctx.ports.files.stat(file.value);
  if (!stat.ok) return stat;
  if (!stat.value) return err('backup.missing', `There is no backup "${id}".`);
  const index = await indexStore(ctx).read();
  const imported = index.ok && index.value.imported.includes(id);
  const cacheKey = `${file.value}|${stat.value.size}|${stat.value.mtimeMs}|${imported}`;
  const cached = viewCache.get(file.value);
  if (cached?.key === cacheKey) return ok(cached.view);
  const base = {
    id,
    name: id.slice(0, -'.zip'.length),
    createdAt: new Date(stat.value.mtimeMs).toISOString(),
    machine: '',
    appVersion: '',
    scopeKind: 'custom' as const,
    scopeLabel: '',
    size: stat.value.size,
    fileCount: 0,
    totalBytes: 0,
    items: [],
    records: [],
    profiles: [],
    snapshots: [],
    changeRecords: [],
    imported,
  };
  const bytes = await ctx.ports.files.readBytes(file.value);
  const manifest = bytes.ok ? readManifest(bytes.value) : bytes;
  const stored = manifest.ok && bytes.ok ? profileNamesIn(bytes.value, manifest.value) : new Map();
  const view: BackupView =
    manifest.ok && bytes.ok
      ? {
          ...base,
          createdAt: manifest.value.createdAt,
          machine: manifest.value.machine,
          appVersion: manifest.value.appVersion,
          scopeKind: manifest.value.scope.kind,
          scopeLabel: manifest.value.scope.label,
          fileCount: manifest.value.totals.files,
          totalBytes: manifest.value.totals.bytes,
          items: manifest.value.items.map((i) => ({
            label: i.label,
            ...(i.game ? { game: i.game } : {}),
            fileCount: i.files.length,
            sourceName: i.sourceName,
          })),
          records: manifest.value.records.map((r) => ({ label: r.label, from: r.from })),
          profiles: await profileNames(ctx, stored, manifest.value),
          ...(await historyNames(ctx, bytes.value, stored, manifest.value)),
        }
      : { ...base, damaged: manifest.ok ? 'It cannot be read.' : manifest.error.message };
  viewCache.set(file.value, { key: cacheKey, view });
  return ok(view);
}

/** Every archive in the backups folder, newest first. */
export async function listBackups(ctx: Ctx): Promise<Result<BackupView[]>> {
  const names = await ctx.ports.files.list(backupRoot(ctx));
  if (!names.ok) return names;
  const views: BackupView[] = [];
  for (const name of names.value) {
    if (!name.toLowerCase().endsWith('.zip') || !backupFile(ctx, name).ok) continue;
    const view = await describeBackup(ctx, name);
    if (view.ok) views.push(view.value);
  }
  views.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
  return ok(views);
}

/** Deletes the oldest backups made on this PC beyond the "keep" setting. Never `keepId` or imported ones. */
export async function applyRetention(ctx: Ctx, keepId?: string): Promise<string[]> {
  const prefs = await prefsStore(ctx).read();
  const keep = prefs.ok ? prefs.value.keepBackups : 20;
  if (keep === 0) return [];
  const all = await listBackups(ctx);
  if (!all.ok) return [];
  const own = all.value.filter((b) => !b.imported && !b.damaged);
  const removed: string[] = [];
  for (const backup of own.slice(keep)) {
    if (backup.id === keepId) continue;
    const file = backupFile(ctx, backup.id);
    if (!file.ok) continue;
    const gone = await ctx.ports.files.remove(file.value, { reason: 'Old backup' });
    if (gone.ok) removed.push(backup.name);
  }
  if (removed.length > 0) ctx.log.info('removed old backups', removed);
  return removed;
}

export async function renameBackup(
  ctx: Ctx,
  id: string,
  name: string
): Promise<Result<BackupView>> {
  const from = backupFile(ctx, id);
  if (!from.ok) return from;
  const clean = cleanName(name);
  if (!clean) return err('backup.name', 'Give the backup a name.');
  const nextId = `${clean}.zip`;
  if (nextId === id) return describeBackup(ctx, id);
  const to = backupFile(ctx, nextId);
  if (!to.ok) return to;
  if (nextId.toLowerCase() !== id.toLowerCase() && (await ctx.ports.files.exists(to.value))) {
    return err('backup.duplicate', `There is already a backup named "${clean}".`);
  }
  const moved = await ctx.ports.files.move(from.value, to.value, { reason: 'Rename backup' });
  if (!moved.ok) return moved;
  await indexStore(ctx).update((index) => ({
    imported: index.imported.map((i) => (i === id ? nextId : i)),
  }));
  return describeBackup(ctx, nextId);
}

export async function removeBackup(ctx: Ctx, id: string): Promise<Result<void>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  if (!(await ctx.ports.files.exists(file.value)))
    return err('backup.missing', `There is no backup "${id}".`);
  const removed = await ctx.ports.files.remove(file.value, { reason: 'Delete backup' });
  if (!removed.ok) return removed;
  await indexStore(ctx).update((index) => ({ imported: index.imported.filter((i) => i !== id) }));
  return ok(undefined);
}

export const ZIP_FILTER = [{ name: 'RigReady backup', extensions: ['zip'] }];

/** Copies a backup to a place the user picks (a USB stick, a NAS share). */
export async function exportBackup(ctx: Ctx, id: string): Promise<Result<{ path: string } | null>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  const target = await ctx.ports.dialogs.save({
    title: 'Export backup',
    defaultPath: path.join(ctx.ports.folders.documents(), id),
    filters: ZIP_FILTER,
  });
  if (!target.ok) return target;
  if (target.value === null) return ok(null);
  const copied = await ctx.ports.files.copy(file.value, target.value, {
    reason: `Export backup ${id.slice(0, -4)}`,
  });
  if (!copied.ok) return copied;
  const [a, b] = await Promise.all([
    ctx.ports.files.readBytes(file.value),
    ctx.ports.files.readBytes(target.value),
  ]);
  if (!a.ok || !b.ok || sha256(a.value) !== sha256(b.value)) {
    return err('backup.export', `The copy at ${target.value} does not match the backup.`);
  }
  return ok({ path: target.value });
}

/** Adds a backup file from elsewhere (a USB stick, another PC) to the list, after checking it. */
export async function addBackupFile(ctx: Ctx): Promise<Result<BackupView | null>> {
  const picked = await ctx.ports.dialogs.open({ title: 'Open backup file', filters: ZIP_FILTER });
  if (!picked.ok) return picked;
  const source = picked.value[0];
  if (!source) return ok(null);
  const opened = await openArchive(ctx, source);
  if (!opened.ok) return opened;
  const bytes = await ctx.ports.files.readBytes(source);
  if (!bytes.ok) return bytes;
  const hash = sha256(bytes.value);
  const existing = await listBackups(ctx);
  if (existing.ok) {
    for (const backup of existing.value) {
      const file = backupFile(ctx, backup.id);
      if (!file.ok || backup.size !== bytes.value.length) continue;
      const other = await ctx.ports.files.readBytes(file.value);
      if (other.ok && sha256(other.value) === hash) return ok(backup);
    }
  }
  const base = cleanName(path.basename(source).replace(/\.zip$/i, '')) || 'Backup';
  const id = await uniqueId(ctx, base);
  const written = await ctx.ports.files.write(path.join(backupRoot(ctx), id), bytes.value, {
    reason: 'Backup',
  });
  if (!written.ok) return written;
  await indexStore(ctx).update((index) => ({ imported: [...index.imported, id] }));
  return describeBackup(ctx, id);
}

/** Shows the backup in Explorer. */
export async function revealBackup(ctx: Ctx, id: string): Promise<Result<void>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  if (!(await ctx.ports.files.exists(file.value)))
    return err('backup.missing', `There is no backup "${id}".`);
  const windows = ctx.ports.folders.windows();
  const shown = await ctx.ports.shell.launch(path.join(windows, 'explorer.exe'), [
    '/select,',
    file.value,
  ]);
  return shown.ok ? ok(undefined) : shown;
}
