import path from 'node:path';
import { z } from 'zod';
import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { registryValuePath } from '../../../core/files/registryValues';
import { err, ok, type Result } from '../../../core/result';
import type { ChangeResult, Snapshot, SnapshotRestoreReview } from '../contract';
import { oneAtATime, whyBlocked } from './change';
import { parseControllerMap, parseSaveKey, textOfBinary, type ControllerMap } from './rewired';
import { GAME_NAME, mapsInUse, REGISTRY_KEY, type BindingsContext } from './view';

/**
 * Named snapshots of Nuclear Option's bindings, kept in RigReady's own folder
 * (<data root>/snapshots/nuclear-option/<id>.json): every saved map of every controller,
 * the keyboard and the mouse, as the bytes the registry held.
 *
 * Restoring puts the bytes back into the values the game still uses, through FileStore (a
 * backup first, one entry on the Safety page, Undo). A value the game no longer has, or no
 * longer uses, cannot be put back: RigReady replaces a value, it does not make one
 * (src/core/files/registryValues.ts).
 *
 * A snapshot file is read as untrusted: only bytes that are a saved map, of the same kind and
 * the same controller as the value they would replace, are ever written.
 */

const FileSchema = z.object({
  format: z.literal(1),
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  /** The saved maps: the registry value's name and its bytes as hex, whole bytes, at least one. */
  maps: z.array(
    z.object({
      valueName: z.string().min(1),
      hex: z.string().regex(/^([0-9a-f]{2})+$/),
    })
  ),
});
type SnapshotFile = z.infer<typeof FileSchema>;

const DAMAGED = 'That snapshot’s file is damaged, so RigReady does not use it. It can be deleted.';

const root = (ctx: BindingsContext): string =>
  path.join(ctx.ports.folders.dataRoot(), 'snapshots', 'nuclear-option');
const fileOf = (ctx: BindingsContext, id: string): string => path.join(root(ctx), `${id}.json`);
/** An id is a file name RigReady made: nothing else is ever read or deleted by it. */
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'snapshot';
}

/** The saved map a snapshot's bytes are; undefined when they are not one. */
function mapOf(hex: string): ControllerMap | undefined {
  const text = textOfBinary(hex);
  const map = text === undefined ? undefined : parseControllerMap(text);
  return map?.ok ? map.value : undefined;
}

/** What a saved map is of, in words: the controller's name, the keyboard, the mouse. */
function ownerOf(map: Pick<ControllerMap, 'kind' | 'hardwareName'>): string {
  if (map.kind === 'KeyboardMap') return 'the keyboard';
  if (map.kind === 'MouseMap') return 'the mouse';
  return map.hardwareName || 'a controller';
}

const bindingsOf = (map: ControllerMap | undefined): number =>
  map ? map.buttonMaps.length + map.axisMaps.length : 0;

/** The saved maps the registry holds now: every ControllerMap value stored as bytes. */
async function mapsNow(ctx: BindingsContext): Promise<Result<Map<string, string>>> {
  const values = await ctx.ports.registry.listValues('HKCU', REGISTRY_KEY);
  if (!values.ok) return values;
  const maps = new Map<string, string>();
  for (const [name, value] of Object.entries(values.value)) {
    if (parseSaveKey(name)?.dataType !== 'ControllerMap' || value.type !== 'binary') continue;
    maps.set(name, value.value.toLowerCase());
  }
  return ok(maps);
}

function view(id: string, file: SnapshotFile): Snapshot {
  const maps = file.maps.map((m) => mapOf(m.hex));
  const owners = [...new Set(maps.flatMap((m) => (m && bindingsOf(m) > 0 ? [ownerOf(m)] : [])))];
  return {
    id,
    name: file.name,
    createdAt: file.createdAt,
    maps: file.maps.length,
    bindings: maps.reduce((sum, m) => sum + bindingsOf(m), 0),
    devices: owners.sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * A snapshot's file as RigReady wrote it. Damaged: not JSON, not the format, a value named
 * twice, or bytes that are not a saved map of the kind the value's own name says.
 */
async function read(ctx: BindingsContext, id: string): Promise<Result<SnapshotFile>> {
  if (!ID.test(id)) return err('nuclear-option.snapshot.missing', 'There is no such snapshot.');
  const text = await ctx.ports.files.readText(fileOf(ctx, id));
  if (!text.ok) return err('nuclear-option.snapshot.missing', 'There is no such snapshot.');
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch {
    return err('nuclear-option.snapshot.invalid', DAMAGED);
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) return err('nuclear-option.snapshot.invalid', DAMAGED);
  const names = new Set<string>();
  for (const entry of parsed.data.maps) {
    const key = parseSaveKey(entry.valueName);
    const map = mapOf(entry.hex);
    if (
      names.has(entry.valueName) ||
      key?.dataType !== 'ControllerMap' ||
      !map ||
      map.kind !== key.parts.controllerMapType
    ) {
      return err('nuclear-option.snapshot.invalid', DAMAGED);
    }
    names.add(entry.valueName);
  }
  return ok(parsed.data);
}

async function store(ctx: BindingsContext, id: string, file: SnapshotFile): Promise<Result<void>> {
  const made = await ctx.ports.files.mkdir(root(ctx));
  if (!made.ok) return made;
  const written = await ctx.ports.files.write(fileOf(ctx, id), JSON.stringify(file, null, 2), {
    reason: `Keep a snapshot of ${GAME_NAME}’s bindings`,
  });
  return written.ok ? ok(undefined) : written;
}

/**
 * The snapshots kept, newest first. A file that cannot be used is listed as damaged, by its
 * file's name, so that it can be seen and deleted.
 */
export async function listSnapshots(ctx: BindingsContext): Promise<Result<Snapshot[]>> {
  const names = await ctx.ports.files.list(root(ctx));
  if (!names.ok) return names;
  const snapshots: Snapshot[] = [];
  for (const name of names.value.filter((n) => n.endsWith('.json'))) {
    const id = name.slice(0, -'.json'.length);
    if (!ID.test(id)) continue;
    const file = await read(ctx, id);
    snapshots.push(
      file.ok
        ? view(id, file.value)
        : { id, name: id, createdAt: '', maps: 0, bindings: 0, devices: [], damaged: true }
    );
  }
  return ok(snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

/** Keeps the bindings as the registry holds them now, under a name. The registry is only read. */
export function createSnapshot(ctx: BindingsContext, name: string): Promise<Result<Snapshot>> {
  // One at a time, with the saves: two taken at once under one name must not share a file.
  return oneAtATime(async (): Promise<Result<Snapshot>> => {
    const trimmed = name.trim();
    if (!trimmed) return err('nuclear-option.snapshot.name', 'Give the snapshot a name.');
    const now = await mapsNow(ctx);
    if (!now.ok) return now;
    const used = await mapsInUse(ctx);
    if (!used.ok) return used;
    // The maps the game uses now and RigReady can read: a map an earlier build left behind
    // is not the game's bindings, and the file must be usable when it is read back.
    const maps = [...now.value]
      .filter(([valueName, hex]) => {
        const map = mapOf(hex);
        return (
          used.value.has(valueName) &&
          map !== undefined &&
          map.kind === parseSaveKey(valueName)?.parts.controllerMapType
        );
      })
      .map(([valueName, hex]) => ({ valueName, hex }));
    if (maps.length === 0) {
      return err(
        'nuclear-option.snapshot.nothing',
        'Nuclear Option has saved no bindings yet, so there is nothing to keep.'
      );
    }
    const createdAt = ctx.ports.clock.now().toISOString();
    const stamp = createdAt.replace(/[^0-9]/g, '').slice(0, 14);
    let id = `${stamp}-${slug(trimmed)}`;
    // Two taken in the same second under the same name are both kept.
    for (let n = 2; await ctx.ports.files.exists(fileOf(ctx, id)); n++) {
      id = `${stamp}-${slug(trimmed)}-${n}`;
    }
    const file: SnapshotFile = { format: 1, name: trimmed.slice(0, 80), createdAt, maps };
    const stored = await store(ctx, id, file);
    return stored.ok ? ok(view(id, file)) : stored;
  });
}

export async function renameSnapshot(
  ctx: BindingsContext,
  id: string,
  name: string
): Promise<Result<Snapshot>> {
  const trimmed = name.trim();
  if (!trimmed) return err('nuclear-option.snapshot.name', 'Give the snapshot a name.');
  const file = await read(ctx, id);
  if (!file.ok) return file;
  const renamed = { ...file.value, name: trimmed.slice(0, 80) };
  const stored = await store(ctx, id, renamed);
  return stored.ok ? ok(view(id, renamed)) : stored;
}

/** Deletes a snapshot's file, also one that is damaged: it is RigReady's own, by its name. */
export async function deleteSnapshot(
  ctx: BindingsContext,
  id: string
): Promise<Result<{ deleted: boolean }>> {
  if (!ID.test(id) || !(await ctx.ports.files.exists(fileOf(ctx, id)))) {
    return err('nuclear-option.snapshot.missing', 'There is no such snapshot.');
  }
  const removed = await ctx.ports.files.remove(fileOf(ctx, id), {
    reason: `Delete a snapshot of ${GAME_NAME}’s bindings`,
  });
  return removed.ok ? ok({ deleted: true }) : removed;
}

interface RestorePlan {
  name: string;
  /** The values that differ from the snapshot and that the game still uses, each with what it becomes. */
  writes: { valueName: string; address: string; bytes: Uint8Array; owner: string }[];
  devices: SnapshotRestoreReview['devices'];
  /** Saved maps of the snapshot the game no longer has, or no longer uses, by what they were of. */
  gone: string[];
  /** Saved maps the game uses now that the snapshot does not hold: left as they are. */
  newer: string[];
  seen: string;
}

async function planRestore(ctx: BindingsContext, id: string): Promise<Result<RestorePlan>> {
  const file = await read(ctx, id);
  if (!file.ok) return file;
  const now = await mapsNow(ctx);
  if (!now.ok) return now;
  const used = await mapsInUse(ctx);
  if (!used.ok) return used;
  const writes: RestorePlan['writes'] = [];
  const devices = new Map<string, { now: number; then: number }>();
  const gone: string[] = [];
  const kept = new Set<string>();
  for (const entry of file.value.maps) {
    kept.add(entry.valueName);
    const then = mapOf(entry.hex)!;
    const owner = ownerOf(then);
    const inUse = used.value.get(entry.valueName);
    const current = now.value.get(entry.valueName);
    // As it was: nothing to do, whether the game still uses the value or not.
    if (current === entry.hex) continue;
    // No such value any more, or one the game left behind and no longer reads (or that
    // RigReady cannot read now): writing it would change nothing the game uses.
    if (current === undefined || !inUse) {
      if (bindingsOf(then) > 0) gone.push(owner);
      continue;
    }
    // The bytes must be a map of what the value is a map of: the same kind, the same
    // controller, the same tab. Anything else is not this value's snapshot.
    if (
      inUse.kind !== then.kind ||
      inUse.hardwareName !== then.hardwareName ||
      inUse.categoryId !== then.categoryId
    ) {
      return err('nuclear-option.snapshot.invalid', DAMAGED);
    }
    const count = devices.get(owner) ?? { now: 0, then: 0 };
    devices.set(owner, { now: count.now + inUse.bindings, then: count.then + bindingsOf(then) });
    writes.push({
      valueName: entry.valueName,
      address: registryValuePath('HKCU', REGISTRY_KEY, entry.valueName),
      bytes: new Uint8Array(Buffer.from(entry.hex, 'hex')),
      owner,
    });
  }
  const newer = [...used.value]
    .filter(([name, map]) => !kept.has(name) && map.bindings > 0)
    .map(([, map]) => ownerOf(map));
  return ok({
    name: file.value.name,
    writes,
    devices: [...devices]
      .map(([name, count]) => ({ name, ...count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    gone: [...new Set(gone)].sort(),
    newer: [...new Set(newer)].sort(),
    // What the preview was made from: every saved map as the registry holds it now, and the
    // snapshot's own maps, so that neither can change between the review and the restore.
    seen: sha256(
      JSON.stringify([
        [...now.value].sort(([a], [b]) => a.localeCompare(b)),
        file.value.maps.map((m) => [m.valueName, m.hex]),
      ])
    ),
  });
}

const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** What was left out, said with every result: a restore never claims more than it did. */
const notPutBack = (gone: string[]): string =>
  gone.length === 0
    ? ''
    : ` Not put back: ${listed(gone)}, which the game no longer has saved bindings for.`;

/** Restoring a snapshot as it would be. Writes nothing. */
export async function reviewRestore(
  ctx: BindingsContext,
  id: string
): Promise<Result<SnapshotRestoreReview>> {
  const planned = await planRestore(ctx, id);
  if (!planned.ok) return planned;
  const p = planned.value;
  const owners = new Map(p.writes.map((w) => [w.address, w.owner]));
  const preview = await changePreview(
    ctx.ports.files,
    p.writes.map((w) => ({ path: w.address, content: w.bytes })),
    (write) =>
      `${GAME_NAME}’s saved bindings for ${owners.get(write.path) ?? 'a device'} (registry)`
  );
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    name: p.name,
    devices: p.devices,
    gone: p.gone,
    newer: p.newer,
    same: p.writes.length === 0,
    ...(blocked ? { blocked } : {}),
    preview: preview.value,
    seen: p.seen,
  });
}

/**
 * Puts a snapshot's bindings back: refused while the game runs, a backup first, one entry on
 * the Safety page, and each value is read back before anything is called done.
 */
export function applyRestore(
  ctx: BindingsContext,
  id: string,
  seen?: string
): Promise<Result<ChangeResult>> {
  return oneAtATime(async (): Promise<Result<ChangeResult>> => {
    const blocked = await whyBlocked(ctx);
    if (blocked) return err('nuclear-option.edit.blocked', blocked);
    const planned = await planRestore(ctx, id);
    if (!planned.ok) return planned;
    const p = planned.value;
    if (seen !== undefined && seen !== p.seen) {
      return err(
        'nuclear-option.edit.changed',
        'The game’s saved bindings changed after the change was shown, so nothing was written. Look at the change again.'
      );
    }
    if (p.writes.length === 0) {
      return ok({
        changed: false,
        message:
          p.gone.length === 0
            ? `Nothing was changed: the bindings are as they were in “${p.name}”.`
            : `Nothing was changed: what the game still has is as it was in “${p.name}”.${notPutBack(p.gone)}`,
      });
    }
    const group = ctx.ports.files.beginGroup(
      `${GAME_NAME} bindings: snapshot “${p.name}” restored`
    );
    let done = 0;
    const partly = (message: string): string =>
      done === 0
        ? message
        : `${message} Part of the snapshot was already put back; Undo on the Safety page takes it out again.`;
    for (const write of p.writes) {
      const written = await ctx.ports.files.write(write.address, write.bytes, {
        reason: `Put back a snapshot of what ${GAME_NAME} saved in the registry`,
        group,
      });
      if (!written.ok) return err(written.error.code, partly(written.error.message));
      done++;
      const back = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, write.valueName);
      if (!back.ok) return err(back.error.code, partly(back.error.message));
      const keptIt =
        back.value?.type === 'binary' &&
        back.value.value.toLowerCase() === Buffer.from(write.bytes).toString('hex');
      if (!keptIt) {
        return err('nuclear-option.edit.notKept', partly('The registry did not keep the change.'));
      }
    }
    const devices = p.devices.length === 1 ? '1 device' : `${p.devices.length} devices`;
    return ok({
      changed: true,
      message: `Restored: “${p.name}” is back on ${devices}.${notPutBack(p.gone)} Undo is on the Safety page.`,
    });
  });
}
