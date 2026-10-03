import path from 'node:path';
import { z } from 'zod';
import { sha256 } from '../../../core/files/fileStore';
import { JsonStore } from '../../../core/jsonStore';
import { err, ok, type Result } from '../../../core/result';
import { resolveTrackedItem, TrackedItemSchema, trackedFileTarget } from '../../../core/tracked';
import { BlobStore } from './blobs';
import { compareFiles, type Comparison } from './compare';
import { fingerprintStore } from './fingerprints';
import { itemsOf, pathVariables, type Ctx } from './store';

const SnapshotSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  scope: z.string(),
  /** The item as it was when the snapshot was taken. */
  item: TrackedItemSchema,
  files: z.array(z.object({ path: z.string(), sha256: z.string(), size: z.number().int() })),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const IndexSchema = z.object({ snapshots: z.array(SnapshotSchema).default([]) });

export const snapshotStore = (ctx: Pick<Ctx, 'ports'>) =>
  new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'backup', 'snapshots.json'),
    IndexSchema
  );

export const blobsOf = (ctx: Pick<Ctx, 'ports'>): BlobStore =>
  new BlobStore(ctx.ports.files, ctx.ports.folders.dataRoot());

export interface SnapshotView {
  id: string;
  name: string;
  createdAt: string;
  scope: string;
  itemLabel: string;
  itemPath: string;
  fileCount: number;
  totalBytes: number;
}

const view = (s: Snapshot): SnapshotView => ({
  id: s.id,
  name: s.name,
  createdAt: s.createdAt,
  scope: s.scope,
  itemLabel: s.item.label,
  itemPath: s.item.path,
  fileCount: s.files.length,
  totalBytes: s.files.reduce((sum, f) => sum + f.size, 0),
});

export async function listSnapshots(ctx: Ctx): Promise<Result<SnapshotView[]>> {
  const index = await snapshotStore(ctx).read();
  if (!index.ok) return index;
  return ok([...index.value.snapshots].reverse().map(view));
}

/** Copies every file of one tracked item into the blob store under a name. */
export async function takeSnapshot(
  ctx: Ctx,
  scope: string,
  itemId: string,
  name: string
): Promise<Result<SnapshotView>> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    return err('snapshot.name', 'A snapshot name must be 1 to 80 characters.');
  const items = await itemsOf(ctx, scope);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.id === itemId);
  if (!item) return err('snapshot.noItem', 'That item is no longer tracked.');
  const resolved = await resolveTrackedItem(ctx.ports.files, item, await pathVariables(ctx));
  if (resolved.problem && resolved.files.length === 0)
    return err('snapshot.unresolved', resolved.problem);
  if (resolved.files.length === 0)
    return err('snapshot.empty', `"${item.label}" has no files on this PC.`);
  const blobs = blobsOf(ctx);
  const files: Snapshot['files'] = [];
  for (const file of resolved.files) {
    const bytes = await ctx.ports.files.readBytes(file.path);
    if (!bytes.ok) return err('snapshot.read', `Could not read ${file.path}.`, bytes.error.detail);
    const stored = await blobs.put(bytes.value);
    if (!stored.ok) return stored;
    files.push({ path: file.relativePath, sha256: stored.value, size: bytes.value.length });
  }
  const now = ctx.ports.clock.now();
  const snapshot: Snapshot = {
    id: `${now.getTime().toString(36)}-${sha256(trimmed + itemId).slice(0, 6)}`,
    name: trimmed,
    createdAt: now.toISOString(),
    scope,
    item,
    files,
  };
  const saved = await snapshotStore(ctx).update((index) => ({
    snapshots: [...index.snapshots, snapshot],
  }));
  return saved.ok ? ok(view(snapshot)) : saved;
}

async function find(ctx: Ctx, id: string): Promise<Result<Snapshot>> {
  const index = await snapshotStore(ctx).read();
  if (!index.ok) return index;
  const snapshot = index.value.snapshots.find((s) => s.id === id);
  return snapshot ? ok(snapshot) : err('snapshot.missing', 'That snapshot no longer exists.');
}

/** The snapshot against the files as they are now. */
export async function compareSnapshot(
  ctx: Ctx,
  id: string
): Promise<Result<{ snapshot: SnapshotView; comparison: Comparison; folder?: string }>> {
  const snapshot = await find(ctx, id);
  if (!snapshot.ok) return snapshot;
  const resolved = await resolveTrackedItem(
    ctx.ports.files,
    snapshot.value.item,
    await pathVariables(ctx)
  );
  const comparison = await compareFiles(
    (file) => ctx.ports.files.readBytes(file),
    blobsOf(ctx),
    snapshot.value.files.map((f) => ({
      key: f.path,
      sha256: f.sha256,
      size: f.size,
      stored: true,
    })),
    resolved.files.map((f) => ({ key: f.relativePath, path: f.path }))
  );
  return ok({
    snapshot: view(snapshot.value),
    comparison,
    ...(resolved.absolute ? { folder: resolved.absolute } : {}),
  });
}

/** Writes back every file that differs from the snapshot or is missing, as one undoable action. */
export async function restoreSnapshot(
  ctx: Ctx,
  id: string
): Promise<Result<{ written: number; leftAlone: number; groupId?: string }>> {
  const snapshot = await find(ctx, id);
  if (!snapshot.ok) return snapshot;
  const resolved = await resolveTrackedItem(
    ctx.ports.files,
    snapshot.value.item,
    await pathVariables(ctx)
  );
  if (!resolved.absolute)
    return err('snapshot.unresolved', resolved.problem ?? 'The item cannot be found on this PC.');
  const blobs = blobsOf(ctx);
  const reason = `Put back snapshot "${snapshot.value.name}" of ${snapshot.value.item.label}`;
  const group = ctx.ports.files.beginGroup(reason);
  let written = 0;
  for (const file of snapshot.value.files) {
    const target = trackedFileTarget(snapshot.value.item, resolved.absolute, file.path);
    const current = await ctx.ports.files.readBytes(target);
    if (current.ok && sha256(current.value) === file.sha256) continue;
    const bytes = await blobs.get(file.sha256);
    if (!bytes.ok) return bytes;
    const result = await ctx.ports.files.write(target, bytes.value, { reason, group });
    if (!result.ok) return result;
    const back = await ctx.ports.files.readBytes(target);
    if (!back.ok || sha256(back.value) !== file.sha256) {
      return err('snapshot.verify', `${target} does not match the snapshot after writing.`);
    }
    written++;
  }
  const kept = new Set(snapshot.value.files.map((f) => f.path.toLowerCase()));
  const leftAlone = resolved.files.filter((f) => !kept.has(f.relativePath.toLowerCase())).length;
  return ok({ written, leftAlone, ...(written > 0 ? { groupId: group.id } : {}) });
}

export async function renameSnapshot(
  ctx: Ctx,
  id: string,
  name: string
): Promise<Result<SnapshotView>> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    return err('snapshot.name', 'A snapshot name must be 1 to 80 characters.');
  const found = await find(ctx, id);
  if (!found.ok) return found;
  const saved = await snapshotStore(ctx).update((index) => ({
    snapshots: index.snapshots.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  }));
  return saved.ok ? ok(view({ ...found.value, name: trimmed })) : saved;
}

export async function removeSnapshot(ctx: Ctx, id: string): Promise<Result<void>> {
  const found = await find(ctx, id);
  if (!found.ok) return found;
  const saved = await snapshotStore(ctx).update((index) => ({
    snapshots: index.snapshots.filter((s) => s.id !== id),
  }));
  if (!saved.ok) return saved;
  await sweepBlobs(ctx);
  return ok(undefined);
}

/** Removes stored file contents that no snapshot and no "last worked" record needs any more. */
export async function sweepBlobs(ctx: Ctx): Promise<void> {
  const keep = new Set<string>();
  const snapshots = await snapshotStore(ctx).read();
  const prints = await fingerprintStore(ctx).read();
  // When either index cannot be read, keep everything.
  if (!snapshots.ok || !prints.ok) return;
  for (const s of snapshots.value.snapshots) for (const f of s.files) keep.add(f.sha256);
  for (const p of Object.values(prints.value.profiles))
    for (const f of p.files) if (f.stored) keep.add(f.sha256);
  await blobsOf(ctx).sweep(keep);
}
