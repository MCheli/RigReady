import path from 'node:path';
import type { z } from 'zod';
import { dcsGuidText, sameGuid } from '../../../core/directInput';
import { parseLuaData } from '../../../core/lua/data';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import { profileFolderName } from './aircraft';
import type { DcsBindings } from './bindings';
import { PlanBuilder, executePlan, planView, type Applied, type ChangePlan } from './changes';
import { comboId, readDiff, sameFilter, type DiffEntry } from './diff';
import { SnapshotMetaSchema, type Comparison, type Snapshot } from './model';
import { comboLabel, diffFileNameFor, fullIdFor, parseDiffFileName } from './names';

/**
 * Named snapshots of the binding files, kept under RigReady's own folder
 * (<data root>/snapshots/dcs/<id>/), with what is needed to restore them later or on
 * another PC: the aircraft covered, the DCS version, and the devices with their ids.
 */

export type { Comparison, Snapshot };

const INCLUDE = ['*.diff.lua', 'modifiers.lua', 'disabled.lua', 'wizard.lua'];

function snapshotsRoot(bindings: DcsBindings): string {
  return path.join(bindings.ctx.ports.folders.dataRoot(), 'snapshots', 'dcs');
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'snapshot';
}

async function dcsVersion(bindings: DcsBindings, userDir: string): Promise<string> {
  const log = await bindings.ctx.ports.files.readText(path.join(userDir, 'Logs', 'dcs.log'));
  return (log.ok ? /DCS\/([0-9.]+)/.exec(log.value)?.[1] : undefined) ?? 'unknown';
}

async function readSnapshot(bindings: DcsBindings, id: string): Promise<Result<Snapshot>> {
  const { files } = bindings.ctx.ports;
  const dir = path.join(snapshotsRoot(bindings), id);
  const text = await files.readText(path.join(dir, 'snapshot.json'));
  if (!text.ok) return err('dcs.snapshot.missing', `There is no snapshot "${id}".`);
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch {
    return err('dcs.snapshot.invalid', `The snapshot "${id}" is damaged.`);
  }
  const meta = SnapshotMetaSchema.safeParse(raw);
  if (!meta.success) return err('dcs.snapshot.invalid', `The snapshot "${id}" is damaged.`);
  const tree = await files.listTree(path.join(dir, 'Input'));
  if (!tree.ok) return tree;
  return ok({
    ...meta.data,
    id,
    files: tree.value.length,
    bytes: tree.value.reduce((sum, f) => sum + f.size, 0),
    folders: [
      ...new Set(
        tree.value
          .filter((f) => f.relativePath.includes('/'))
          .map((f) => f.relativePath.split('/')[0]!)
      ),
    ].sort(),
  });
}

export async function listSnapshots(bindings: DcsBindings): Promise<Result<Snapshot[]>> {
  const entries = await bindings.ctx.ports.files.listEntries(snapshotsRoot(bindings));
  if (!entries.ok) return entries;
  const snapshots: Snapshot[] = [];
  for (const entry of entries.value.filter((e) => e.isDirectory)) {
    const snapshot = await readSnapshot(bindings, entry.name);
    if (snapshot.ok) snapshots.push(snapshot.value);
  }
  return ok(snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

/** Copies the binding files of the chosen aircraft (or of all, when none are given) into a new snapshot. */
export async function createSnapshot(
  bindings: DcsBindings,
  name: string,
  aircraft: string[]
): Promise<Result<Snapshot>> {
  const { files, clock } = bindings.ctx.ports;
  const trimmed = name.trim();
  if (trimmed === '') return err('dcs.snapshot.name', 'Give the snapshot a name.');
  const locations = await bindings.locations();
  const root = snapshotsRoot(bindings);
  let id = slug(trimmed);
  for (let n = 2; await files.exists(path.join(root, id)); n++) id = `${slug(trimmed)}-${n}`;
  const dest = path.join(root, id, 'Input');
  const reason = `Snapshot "${trimmed}"`;

  let copied = 0;
  if (aircraft.length === 0) {
    const all = await files.copyTree(locations.inputDir, dest, { reason, include: INCLUDE });
    if (!all.ok) return all;
    copied = all.value.files.length;
  } else {
    for (const aircraftId of aircraft) {
      const folder = profileFolderName(aircraftId);
      const one = await files.copyTree(
        path.join(locations.inputDir, folder),
        path.join(dest, folder),
        { reason, include: INCLUDE }
      );
      if (!one.ok) return one;
      copied += one.value.files.length;
    }
  }
  if (copied === 0) {
    return err(
      'dcs.snapshot.empty',
      aircraft.length === 0
        ? 'There are no binding files to snapshot yet.'
        : 'The chosen aircraft have no binding files of their own yet: they are on DCS defaults.'
    );
  }

  const tree = await files.listTree(dest, { include: ['*.diff.lua'] });
  const devices = new Map<string, { name: string; guid?: string }>();
  for (const file of tree.ok ? tree.value : []) {
    const parsed = parseDiffFileName(file.name);
    if (!parsed) continue;
    devices.set(parsed.fullId.toUpperCase(), {
      name: parsed.deviceName,
      ...(parsed.guid ? { guid: dcsGuidText(parsed.guid) } : {}),
    });
  }
  const meta: z.infer<typeof SnapshotMetaSchema> = {
    name: trimmed,
    createdAt: clock.now().toISOString(),
    dcsVersion: await dcsVersion(bindings, locations.userDir),
    aircraft,
    devices: [...devices.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  const written = await files.write(
    path.join(root, id, 'snapshot.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
    { reason }
  );
  if (!written.ok) return written;
  return readSnapshot(bindings, id);
}

export async function renameSnapshot(
  bindings: DcsBindings,
  id: string,
  name: string
): Promise<Result<Snapshot>> {
  const trimmed = name.trim();
  if (trimmed === '') return err('dcs.snapshot.name', 'Give the snapshot a name.');
  const current = await readSnapshot(bindings, id);
  if (!current.ok) return current;
  const { id: _id, files: _files, bytes: _bytes, folders: _folders, ...meta } = current.value;
  const written = await bindings.ctx.ports.files.write(
    path.join(snapshotsRoot(bindings), id, 'snapshot.json'),
    `${JSON.stringify({ ...meta, name: trimmed }, null, 2)}\n`,
    { reason: `Rename snapshot to "${trimmed}"` }
  );
  if (!written.ok) return written;
  return readSnapshot(bindings, id);
}

export async function deleteSnapshot(bindings: DcsBindings, id: string): Promise<Result<void>> {
  const { files } = bindings.ctx.ports;
  const current = await readSnapshot(bindings, id);
  if (!current.ok) return current;
  const dir = path.join(snapshotsRoot(bindings), id);
  const tree = await files.listTree(dir);
  if (!tree.ok) return tree;
  for (const file of tree.value) {
    const removed = await files.remove(file.path, {
      reason: `Delete snapshot "${current.value.name}"`,
    });
    if (!removed.ok) return removed;
  }
  if (await files.exists(path.join(dir, 'snapshot.json'))) {
    return err('dcs.snapshot.delete', 'The snapshot could not be deleted.');
  }
  return ok(undefined);
}

/** The binding files of a source: a snapshot, or what DCS has now. relative path -> text. */
async function readFiles(
  bindings: DcsBindings,
  dir: string,
  folders: string[] | undefined
): Promise<Result<Map<string, { relative: string; text: string }>>> {
  const { files } = bindings.ctx.ports;
  const tree = await files.listTree(dir, { include: INCLUDE });
  if (!tree.ok) return tree;
  const out = new Map<string, { relative: string; text: string }>();
  for (const file of tree.value) {
    const top = file.relativePath.includes('/') ? file.relativePath.split('/')[0]! : '';
    // Files directly in the Input folder (disabled.lua, ...) always count.
    if (folders && top !== '' && !folders.some((f) => f.toLowerCase() === top.toLowerCase())) {
      continue;
    }
    const text = await files.readText(file.path);
    if (!text.ok) return text;
    out.set(file.relativePath.toLowerCase(), { relative: file.relativePath, text: text.value });
  }
  return ok(out);
}

interface Prepared {
  builder: PlanBuilder;
  summary: string;
  dcsRunning: boolean;
}

async function prepareRestore(
  bindings: DcsBindings,
  id: string,
  remapIds: boolean
): Promise<Result<Prepared>> {
  const snapshot = await readSnapshot(bindings, id);
  if (!snapshot.ok) return snapshot;
  const locations = await bindings.locations();
  const connected = await bindings.connectedDevices();
  const stored = await readFiles(
    bindings,
    path.join(snapshotsRoot(bindings), id, 'Input'),
    undefined
  );
  if (!stored.ok) return stored;
  // Everything in the aircraft folders the snapshot holds is replaced; other folders are left alone.
  const current = await readFiles(bindings, locations.inputDir, snapshot.value.folders);
  if (!current.ok) return current;

  // Device ids in the snapshot that are not attached now, but whose device (by name) is, once.
  const remap = new Map<string, InputDevice>();
  const builder = new PlanBuilder();
  const stale = new Set<string>();
  for (const device of snapshot.value.devices) {
    if (!device.guid) continue;
    if (connected.some((d) => d.name === device.name && sameGuid(d.guid, device.guid!))) continue;
    const sameName = connected.filter((d) => d.name === device.name);
    if (sameName.length === 0) continue;
    stale.add(device.name);
    if (remapIds && sameName.length === 1)
      remap.set(fullIdFor(device.name, device.guid).toUpperCase(), sameName[0]!);
  }
  if (stale.size > 0) {
    if (!remapIds) {
      builder.note(
        `${stale.size} ${stale.size === 1 ? 'device has' : 'devices have'} a different device ID now than in this snapshot. The files are restored under the old IDs, where DCS will not find them until you move them on the Device IDs tab.`
      );
    } else {
      const moved = [...stale].filter((name) =>
        [...remap.values()].some((d) => d.name === name)
      ).length;
      if (moved > 0) {
        builder.note(
          `${moved} ${moved === 1 ? 'device has' : 'devices have'} a different device ID now than in this snapshot. Their files are restored under the current IDs, so DCS finds them.`
        );
      }
      if (moved < stale.size) {
        builder.note(
          `${stale.size - moved} ${stale.size - moved === 1 ? 'device' : 'devices'} could not be matched to one attached device (several share the name). Those files are restored under the old IDs; assign them on the Device IDs tab.`
        );
      }
    }
  }

  const rewriteIds = (text: string): string => {
    let next = text;
    for (const [oldId, device] of remap) {
      next = next
        .split(new RegExp(oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
        .join(fullIdFor(device.name, device.guid));
    }
    return next;
  };

  const wanted = new Map<string, { relative: string; text: string }>();
  for (const file of stored.value.values()) {
    const name = path.posix.basename(file.relative);
    const parsed = parseDiffFileName(name);
    const device = parsed ? remap.get(parsed.fullId.toUpperCase()) : undefined;
    const relative = device
      ? path.posix.join(
          path.posix.dirname(file.relative),
          diffFileNameFor(device.name, device.guid)
        )
      : file.relative;
    const text = parsed ? file.text : rewriteIds(file.text);
    wanted.set(relative.toLowerCase(), { relative, text });
  }

  for (const file of wanted.values()) {
    const existing = current.value.get(file.relative.toLowerCase());
    builder.write(
      path.join(locations.inputDir, ...file.relative.split('/')),
      existing?.text ?? null,
      file.text,
      {
        title: file.relative,
        lines: [existing ? 'Put back the content from the snapshot' : 'Restore from the snapshot'],
      }
    );
  }
  for (const [key, file] of current.value) {
    if (wanted.has(key)) continue;
    // Only binding files are removed; shared files outside aircraft folders are left alone.
    if (!file.relative.includes('/')) continue;
    builder.remove(path.join(locations.inputDir, ...file.relative.split('/')), file.text, {
      title: file.relative,
      lines: ['Not in the snapshot: removed, so the bindings match the snapshot'],
    });
  }
  return ok({
    builder,
    summary: `Restore binding snapshot "${snapshot.value.name}"`,
    dcsRunning: await bindings.dcsRunning(),
  });
}

/** The files a restore would write or remove. With `remapIds`, files go under the attached devices' current ids. */
export async function planRestore(
  bindings: DcsBindings,
  id: string,
  remapIds: boolean
): Promise<Result<ChangePlan>> {
  const prepared = await prepareRestore(bindings, id, remapIds);
  if (!prepared.ok) return prepared;
  return ok(planView(prepared.value.summary, prepared.value.builder, prepared.value.dcsRunning));
}

export async function applyRestore(
  bindings: DcsBindings,
  id: string,
  remapIds: boolean
): Promise<Result<Applied>> {
  const prepared = await prepareRestore(bindings, id, remapIds);
  if (!prepared.ok) return prepared;
  return executePlan(
    bindings.ctx.ports,
    prepared.value.summary,
    prepared.value.builder,
    prepared.value.dcsRunning
  );
}

function describe(
  entry: DiffEntry,
  section: 'added' | 'removed' | 'changed',
  label: string
): string {
  if (section === 'removed') return `${entry.name}: DCS's default ${label} cancelled`;
  if (section === 'changed') return `${entry.name}: curve of ${label}`;
  return `${entry.name}: ${label}`;
}

function bindingsOf(text: string): Map<string, { text: string; filter: unknown }> {
  const out = new Map<string, { text: string; filter: unknown }>();
  const parsed = parseLuaData(text);
  if (!parsed.ok) return out;
  for (const entry of readDiff(parsed.value).entries) {
    for (const section of ['added', 'removed', 'changed'] as const) {
      for (const combo of entry[section]) {
        out.set(`${section}|${entry.kind}|${entry.hash}|${comboId(combo)}`, {
          text: describe(entry, section, comboLabel(combo)),
          filter: combo.filter,
        });
      }
    }
  }
  return out;
}

/**
 * Compares two sets of binding files by device name (device ids are ignored, so a
 * snapshot from before an id change still lines up). `rightId` undefined means what
 * DCS has now.
 */
export async function compareSnapshots(
  bindings: DcsBindings,
  leftId: string,
  rightId: string | undefined
): Promise<Result<Comparison>> {
  const left = await readSnapshot(bindings, leftId);
  if (!left.ok) return left;
  const right = rightId === undefined ? undefined : await readSnapshot(bindings, rightId);
  if (right && !right.ok) return right;
  const locations = await bindings.locations();
  const folders = left.value.aircraft.length === 0 ? undefined : left.value.folders;
  const leftFiles = await readFiles(
    bindings,
    path.join(snapshotsRoot(bindings), leftId, 'Input'),
    folders
  );
  if (!leftFiles.ok) return leftFiles;
  const rightFiles = await readFiles(
    bindings,
    right?.ok ? path.join(snapshotsRoot(bindings), right.value.id, 'Input') : locations.inputDir,
    folders
  );
  if (!rightFiles.ok) return rightFiles;

  const byDevice = (
    files: Map<string, { relative: string; text: string }>
  ): Map<string, { folder: string; device: string; text: string }> => {
    const out = new Map<string, { folder: string; device: string; text: string }>();
    for (const file of files.values()) {
      const parsed = parseDiffFileName(path.posix.basename(file.relative));
      if (!parsed) continue;
      const folder = file.relative.split('/')[0]!;
      out.set(`${folder}|${path.posix.dirname(file.relative)}|${parsed.deviceName}`.toLowerCase(), {
        folder,
        device: parsed.deviceName,
        text: file.text,
      });
    }
    return out;
  };
  const a = byDevice(leftFiles.value);
  const b = byDevice(rightFiles.value);
  const devices: Comparison['devices'] = [];
  let identical = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const before = bindingsOf(a.get(key)?.text ?? '');
    const after = bindingsOf(b.get(key)?.text ?? '');
    const added = [...after].filter(([k]) => !before.has(k)).map(([, v]) => v.text);
    const removed = [...before].filter(([k]) => !after.has(k)).map(([, v]) => v.text);
    const changed = [...after]
      .filter(([k, v]) => {
        const old = before.get(k);
        return old !== undefined && !sameFilter(old.filter as never, v.filter as never);
      })
      .map(([, v]) => v.text);
    if (added.length + removed.length + changed.length === 0) {
      identical++;
      continue;
    }
    const info = (a.get(key) ?? b.get(key))!;
    devices.push({ folder: info.folder, device: info.device, added, removed, changed });
  }
  devices.sort((x, y) => x.folder.localeCompare(y.folder) || x.device.localeCompare(y.device));
  return ok({
    left: left.value.name,
    right: right?.ok ? right.value.name : 'Current bindings',
    devices,
    identical,
  });
}
