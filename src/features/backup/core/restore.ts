import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { isProgramFile } from '../../../core/credentials';
import { sameGuid } from '../../../core/directInput';
import { NamedLayoutSchema, type NamedLayout } from '../../../core/displays/layouts';
import { sha256 } from '../../../core/files/fileStore';
import { isWithin } from '../../../core/paths';
import { expandPath } from '../../../core/pathVariables';
import { ProfileSchema, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { AppSettingsSchema } from '../../../core/settings';
import { TrackedItemSchema, trackedFileTarget, unknownVariableText } from '../../../core/tracked';
import {
  backupFile,
  describeBackup,
  openArchive,
  writeArchive,
  type BackupView,
  type Manifest,
  type ManifestItem,
  type OpenedArchive,
} from './archive';
import { MAX_RECORD_ROWS, recordRows, type RecordRow } from './records';
import {
  closeHolders,
  reopenHolders,
  runningHolders,
  runningText,
  type ClosedProgram,
  type Reopen,
  type RestoreTarget,
  type RunningProgram,
} from './programs';
import { sameItem } from './suggestions';
import { globalStore, pathVariables, type Ctx, type MachineIdentity } from './store';

export type FileStatus = 'new' | 'same' | 'different';
export type RestoreAction = 'overwrite' | 'keepBoth';

export interface RestoreFileView {
  ref: string;
  relativePath: string;
  target: string;
  size: number;
  status: FileStatus;
  /** A program or script: worth a second look before restoring. */
  program: boolean;
}

export interface RestoreItemView {
  key: string;
  label: string;
  game?: string;
  sourceName: string;
  /** Files of this item in the backup. */
  fileCount: number;
  /** As stored in the backup: "{DCS_USER}/Config/Input". */
  stored: string;
  /** Stored without a path variable: it may mean a different place on this PC. */
  absolute: boolean;
  target?: string;
  restorable: boolean;
  problem?: string;
  files: RestoreFileView[];
}

export interface RestoreOwnView {
  ref: string;
  kind: 'profile' | 'layout' | 'settings' | 'tracked';
  label: string;
  status: FileStatus;
  detail?: string;
}

export interface RestorePreview {
  backup: BackupView;
  /** True when the backup was made on another PC or under another Windows user. */
  otherMachine: boolean;
  items: RestoreItemView[];
  own: RestoreOwnView[];
  /** Left out when the backup was made: unreadable or credential files. */
  notInBackup: { path: string; reason: string }[];
  /**
   * Games and tools running now that would overwrite restored files when they exit.
   * They have to be closed first; RigReady can ask them to.
   */
  running: RunningProgram[];
  /** Settings kept as data (registry values). Shown for reading; nothing restores them. */
  records: RecordView[];
}

export interface RecordView {
  label: string;
  from: string;
  source: string;
  /** One row per stored value, for the table. */
  rows: RecordRow[];
  /** True when the record holds more values than are listed. */
  moreRows: boolean;
  /** The stored values as text, cut off when very long. */
  text: string;
  truncated: boolean;
}

const RECORD_TEXT_LIMIT = 200_000;

function recordViews(opened: OpenedArchive): RecordView[] {
  return opened.manifest.records.map((record) => {
    const text = new TextDecoder().decode(opened.data.get(`records/${record.path}`)!);
    const rows = recordRows(record.values, text);
    return {
      label: record.label,
      from: record.from,
      source: record.source,
      rows,
      moreRows: rows.length >= MAX_RECORD_ROWS,
      text: text.slice(0, RECORD_TEXT_LIMIT),
      truncated: text.length > RECORD_TEXT_LIMIT,
    };
  });
}

const targetsOf = (
  planned: Planned[],
  wanted: (file: RestoreFileView) => boolean
): RestoreTarget[] =>
  planned
    .filter((p) => p.view.restorable && p.view.target && p.view.files.some(wanted))
    .map((p) => ({
      label: p.view.label,
      target: p.view.target!,
      ...(p.view.game ? { game: p.view.game } : {}),
    }));

export interface ReportEntry {
  ref: string;
  label: string;
  detail?: string;
}

export interface RestoreReport {
  name: string;
  restored: ReportEntry[];
  unchanged: ReportEntry[];
  keptBoth: ReportEntry[];
  skipped: ReportEntry[];
  failed: ReportEntry[];
  /** The journal group of the files written outside RigReady's folder (Safety page, Undo). */
  groupId?: string;
  /** The backup made of everything this restore replaced. */
  safetyBackup?: string;
  /** Set when restored binding files name controllers this PC does not have. */
  deviceIds?: { files: string[]; message: string };
  /** Programs RigReady closed for this restore, and whether the tools among them run again. */
  closed: ClosedProgram[];
}

const LayoutsFileSchema = z.object({ layouts: z.array(NamedLayoutSchema).default([]) });
const TrackedFileSchema = z.object({ items: z.array(TrackedItemSchema).default([]) });

const hashOf = async (ctx: Ctx, file: string): Promise<string | undefined> => {
  const bytes = await ctx.ports.files.readBytes(file);
  return bytes.ok ? sha256(bytes.value) : undefined;
};

const statusOf = async (ctx: Ctx, target: string, hash: string): Promise<FileStatus> => {
  if (!(await ctx.ports.files.exists(target))) return 'new';
  return (await hashOf(ctx, target)) === hash ? 'same' : 'different';
};

function parseYamlProfile(bytes: Uint8Array): Result<Profile> {
  let raw: unknown;
  try {
    raw = yaml.load(new TextDecoder().decode(bytes));
  } catch (e) {
    return err('restore.profile', 'The setup in the backup is not valid YAML.', String(e));
  }
  const parsed = ProfileSchema.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(
        'restore.profile',
        'The setup in the backup is not valid.',
        z.prettifyError(parsed.error)
      );
}

function parseJson<S extends z.ZodType>(bytes: Uint8Array, schema: S): z.output<S> | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const layoutSame = (a: NamedLayout, b: NamedLayout): boolean =>
  a.name === b.name && JSON.stringify(a.displays) === JSON.stringify(b.displays);

interface Planned {
  item: ManifestItem;
  view: RestoreItemView;
}

async function planItems(ctx: Ctx, manifest: Manifest): Promise<Planned[]> {
  const variables = await pathVariables(ctx);
  const dataRoot = ctx.ports.folders.dataRoot();
  const planned: Planned[] = [];
  for (const item of manifest.items) {
    const base = {
      key: item.key,
      label: item.label,
      ...(item.game ? { game: item.game } : {}),
      sourceName: item.sourceName,
      fileCount: item.files.length,
      stored: item.path,
      absolute: item.absolute,
    };
    const expanded = expandPath(item.path, variables);
    if (!expanded.ok) {
      const problem =
        expanded.error.code === 'path.variable'
          ? unknownVariableText(item.path)
          : expanded.error.message;
      planned.push({ item, view: { ...base, restorable: false, problem, files: [] } });
      continue;
    }
    const target = expanded.value;
    if (isWithin(dataRoot, target)) {
      planned.push({
        item,
        view: {
          ...base,
          target,
          restorable: false,
          problem: "RigReady's own folder is restored through setups and settings.",
          files: [],
        },
      });
      continue;
    }
    const files: RestoreFileView[] = [];
    for (const file of item.files) {
      const fileTarget = trackedFileTarget(item, target, file.path);
      files.push({
        ref: `item:${item.key}:${file.path}`,
        relativePath: file.path,
        target: fileTarget,
        size: file.size,
        status: await statusOf(ctx, fileTarget, file.sha256),
        program: isProgramFile(file.path),
      });
    }
    planned.push({
      item,
      view: {
        ...base,
        target,
        restorable: files.length > 0,
        ...(files.length === 0 ? { problem: 'The backup holds no files for this item.' } : {}),
        files,
      },
    });
  }
  return planned;
}

async function planOwn(ctx: Ctx, opened: OpenedArchive): Promise<RestoreOwnView[]> {
  const own: RestoreOwnView[] = [];
  const root = ctx.ports.folders.dataRoot();
  for (const file of opened.manifest.rigready) {
    const data = opened.data.get(`rigready/${file.path}`)!;
    if (file.path.startsWith('profiles/')) {
      const profile = parseYamlProfile(data);
      const id = file.path.slice('profiles/'.length, -'.yaml'.length);
      if (!profile.ok) {
        own.push({
          ref: `profile:${id}`,
          kind: 'profile',
          label: id,
          status: 'new',
          detail: profile.error.message,
        });
        continue;
      }
      const target = path.join(root, 'profiles', `${profile.value.id}.yaml`);
      const status = (await ctx.profiles.get(profile.value.id)).ok
        ? await statusOf(ctx, target, file.sha256)
        : 'new';
      own.push({
        ref: `profile:${profile.value.id}`,
        kind: 'profile',
        label: profile.value.name,
        status,
      });
    } else if (file.path === 'displays/layouts.json') {
      const parsed = parseJson(data, LayoutsFileSchema);
      const current = await ctx.layouts.list();
      for (const layout of parsed?.layouts ?? []) {
        const existing = current.ok ? current.value.find((l) => l.id === layout.id) : undefined;
        own.push({
          ref: `layout:${layout.id}`,
          kind: 'layout',
          label: layout.name,
          status: !existing ? 'new' : layoutSame(existing, layout) ? 'same' : 'different',
          detail: `${layout.displays.filter((d) => d.enabled).length} monitors on`,
        });
      }
    } else if (file.path === 'settings.json') {
      const target = path.join(root, 'settings.json');
      own.push({
        ref: 'settings',
        kind: 'settings',
        label: 'RigReady settings',
        status: await statusOf(ctx, target, file.sha256),
        detail:
          'Desk layout, retention, timeouts. Start with Windows and the API key stay as they are.',
      });
    } else if (file.path === 'backup/tracked.json') {
      const parsed = parseJson(data, TrackedFileSchema);
      const current = await globalStore(ctx).read();
      const missing = (parsed?.items ?? []).filter(
        (item) => !(current.ok ? current.value.items : []).some((c) => sameItem(c, item))
      );
      own.push({
        ref: 'tracked',
        kind: 'tracked',
        label: '"Always back up" list',
        status: missing.length === 0 ? 'same' : 'different',
        detail:
          missing.length === 0
            ? 'Every item is already on the list'
            : `Adds ${missing.length} ${missing.length === 1 ? 'item' : 'items'}`,
      });
    }
  }
  return own;
}

export async function previewRestore(
  ctx: Ctx,
  id: string,
  identity: MachineIdentity
): Promise<Result<RestorePreview>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  const view = await describeBackup(ctx, id);
  if (!view.ok) return view;
  const opened = await openArchive(ctx, file.value);
  if (!opened.ok) return opened;
  const { manifest } = opened.value;
  const planned = await planItems(ctx, manifest);
  const running = await runningHolders(
    ctx,
    targetsOf(planned, (f) => f.status !== 'same')
  );
  return ok({
    running: running.ok ? running.value : [],
    records: recordViews(opened.value),
    backup: view.value,
    otherMachine:
      manifest.machine.toLowerCase() !== identity.machine.toLowerCase() ||
      !identity.users.some((u) => u.toLowerCase() === manifest.user.toLowerCase()),
    items: planned.map((p) => p.view),
    own: await planOwn(ctx, opened.value),
    notInBackup: [...manifest.skipped, ...manifest.withheld],
  });
}

/** "Export.lua" -> "Export (restored 2026-10-03).lua", numbered when that exists too. */
export async function keepBothPath(ctx: Ctx, target: string): Promise<string> {
  const now = ctx.ports.clock.now();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const ext = path.extname(target);
  // ".diff.lua" stays one extension so DCS-style names keep their shape.
  const fullExt = target.toLowerCase().endsWith('.diff.lua') ? '.diff.lua' : ext;
  const stem = target.slice(0, target.length - fullExt.length);
  let candidate = `${stem} (restored ${day})${fullExt}`;
  for (let n = 2; await ctx.ports.files.exists(candidate); n++) {
    candidate = `${stem} (restored ${day} ${n})${fullExt}`;
  }
  return candidate;
}

const GUID_FILE = /\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\.diff\.lua$/i;

/** Binding files whose device id belongs to no controller attached here: the repair flow's job. */
async function unmatchedDeviceFiles(ctx: Ctx, written: string[]): Promise<string[]> {
  const named = written.filter((f) => GUID_FILE.test(path.basename(f)));
  if (named.length === 0) return [];
  let devices = ctx.ports.input.devices();
  if (devices.length === 0) {
    const started = await ctx.ports.input.start();
    devices = started.ok ? started.value : [];
  }
  return named.filter((file) => {
    const guid = GUID_FILE.exec(path.basename(file))![1]!;
    return !devices.some((d) => sameGuid(d.guid, guid));
  });
}

/**
 * Restores the chosen entries. `choices` maps a ref from the preview to what to do;
 * anything not in it is skipped. Everything this replaces is first saved in a
 * "Before restore" backup, and files outside RigReady's folder are written as one
 * journal group, so the Safety page can undo the restore.
 */
export async function applyRestore(
  ctx: Ctx,
  id: string,
  choices: Record<string, RestoreAction>,
  options: { identity: MachineIdentity; appVersion: string; closePrograms?: boolean }
): Promise<Result<RestoreReport>> {
  const file = backupFile(ctx, id);
  if (!file.ok) return file;
  const opened = await openArchive(ctx, file.value);
  if (!opened.ok) return opened;
  const { manifest, data } = opened.value;
  const name = id.slice(0, -'.zip'.length);
  const planned = await planItems(ctx, manifest);
  const own = await planOwn(ctx, opened.value);
  const report: RestoreReport = {
    name,
    restored: [],
    unchanged: [],
    keptBoth: [],
    skipped: [],
    failed: [],
    closed: [],
  };

  // 0. Nothing is written while a game or tool that owns the files would write over them.
  const holding = await runningHolders(
    ctx,
    targetsOf(planned, (f) => choices[f.ref] !== undefined && f.status !== 'same')
  );
  if (!holding.ok) return holding;
  let reopen: Reopen[] = [];
  if (holding.value.length > 0) {
    if (!options.closePrograms) {
      return err(
        'restore.running',
        `${runningText(holding.value)} Close ${holding.value.length === 1 ? 'it' : 'them'} first, or let RigReady close ${holding.value.length === 1 ? 'it' : 'them'}. Nothing was restored.`
      );
    }
    const closed = await closeHolders(ctx, holding.value);
    if (!closed.ok) return closed;
    reopen = closed.value;
    report.closed = holding.value.filter((p) => !p.restart).map((p) => ({ name: p.name }));
  }

  // 1. Save what will be replaced.
  const safetyItems: ManifestItem[] = [];
  const safetyEntries: { path: string; data: Uint8Array }[] = [];
  for (const { item, view } of planned) {
    const replaced = view.files.filter(
      (f) => f.status === 'different' && choices[f.ref] === 'overwrite'
    );
    if (replaced.length === 0) continue;
    const files: ManifestItem['files'] = [];
    for (const f of replaced) {
      const bytes = await ctx.ports.files.readBytes(f.target);
      if (!bytes.ok) continue;
      safetyEntries.push({ path: `items/${item.key}/${f.relativePath}`, data: bytes.value });
      files.push({ path: f.relativePath, size: bytes.value.length, sha256: sha256(bytes.value) });
    }
    safetyItems.push({ ...item, files });
  }
  const safetyOwn: Manifest['rigready'] = [];
  const root = ctx.ports.folders.dataRoot();
  for (const entry of own) {
    if (entry.status !== 'different' || choices[entry.ref] !== 'overwrite') continue;
    const relative =
      entry.kind === 'profile'
        ? `profiles/${entry.ref.slice('profile:'.length)}.yaml`
        : entry.kind === 'layout'
          ? 'displays/layouts.json'
          : entry.kind === 'settings'
            ? 'settings.json'
            : undefined;
    if (!relative || safetyOwn.some((s) => s.path === relative)) continue;
    const bytes = await ctx.ports.files.readBytes(path.join(root, ...relative.split('/')));
    if (!bytes.ok) continue;
    safetyEntries.push({ path: `rigready/${relative}`, data: bytes.value });
    safetyOwn.push({ path: relative, size: bytes.value.length, sha256: sha256(bytes.value) });
  }
  if (safetyEntries.length > 0) {
    const safety = await writeArchive(
      ctx,
      {
        format: 'rigready-backup',
        schemaVersion: 1,
        createdAt: ctx.ports.clock.now().toISOString(),
        machine: options.identity.machine,
        user: options.identity.users[0] ?? '',
        appVersion: options.appVersion,
        scope: { kind: 'before-restore', label: `Before restoring ${name}`, profileIds: [] },
        items: safetyItems,
        rigready: safetyOwn,
        records: [],
        skipped: [],
        withheld: [],
        totals: {
          files: safetyEntries.length,
          bytes: safetyEntries.reduce((sum, e) => sum + e.data.length, 0),
        },
      },
      safetyEntries,
      `Before restoring ${name}`
    );
    if (!safety.ok) {
      await reopenHolders(ctx, reopen);
      return err(
        'restore.safety',
        'Nothing was restored: the current files could not be saved first.',
        safety.error.message
      );
    }
    report.safetyBackup = safety.value.slice(0, -'.zip'.length);
  }

  // 2. Files outside RigReady's folder, one undoable action.
  const group = ctx.ports.files.beginGroup(`Restore backup "${name}"`);
  const written: string[] = [];
  for (const { item, view } of planned) {
    if (!view.restorable) {
      for (const f of item.files) {
        report.skipped.push({
          ref: `item:${item.key}:${f.path}`,
          label: `${item.path}/${f.path}`,
          detail: view.problem ?? '',
        });
      }
      if (item.files.length === 0)
        report.skipped.push({
          ref: `item:${item.key}`,
          label: item.label,
          detail: view.problem ?? '',
        });
      continue;
    }
    for (const f of view.files) {
      const action = choices[f.ref];
      const label = f.target;
      if (!action) {
        report.skipped.push({ ref: f.ref, label, detail: 'Not selected' });
        continue;
      }
      if (f.status === 'same') {
        report.unchanged.push({ ref: f.ref, label, detail: 'Already identical' });
        continue;
      }
      const bytes = data.get(`items/${item.key}/${f.relativePath}`)!;
      const expected = sha256(bytes);
      const target =
        action === 'keepBoth' && f.status === 'different'
          ? await keepBothPath(ctx, f.target)
          : f.target;
      const folder = item.kind === 'file' ? path.dirname(view.target!) : view.target!;
      if (!isWithin(folder, target)) {
        report.failed.push({
          ref: f.ref,
          label,
          detail: 'The file would land outside its folder.',
        });
        continue;
      }
      const result = await ctx.ports.files.write(target, bytes, {
        reason: `Restore backup "${name}"`,
        group,
      });
      if (!result.ok) {
        report.failed.push({
          ref: f.ref,
          label,
          detail: result.error.detail ?? result.error.message,
        });
        continue;
      }
      if ((await hashOf(ctx, target)) !== expected) {
        report.failed.push({
          ref: f.ref,
          label,
          detail: 'The file on disk does not match the backup after writing.',
        });
        continue;
      }
      written.push(target);
      if (target === f.target) report.restored.push({ ref: f.ref, label });
      else report.keptBoth.push({ ref: f.ref, label, detail: target });
    }
  }
  if (written.length > 0) report.groupId = group.id;

  // 3. RigReady's own data.
  for (const entry of own) {
    const action = choices[entry.ref];
    if (!action) {
      report.skipped.push({ ref: entry.ref, label: entry.label, detail: 'Not selected' });
      continue;
    }
    if (entry.status === 'same') {
      report.unchanged.push({ ref: entry.ref, label: entry.label, detail: 'Already identical' });
      continue;
    }
    const outcome = await restoreOwn(ctx, opened.value, entry, action);
    if (!outcome.ok)
      report.failed.push({ ref: entry.ref, label: entry.label, detail: outcome.error.message });
    else if (outcome.value.keptBoth)
      report.keptBoth.push({ ref: entry.ref, label: entry.label, detail: outcome.value.keptBoth });
    else report.restored.push({ ref: entry.ref, label: entry.label });
  }

  report.closed.push(...(await reopenHolders(ctx, reopen)));

  const unmatched = await unmatchedDeviceFiles(ctx, written);
  if (unmatched.length > 0) {
    report.deviceIds = {
      files: unmatched,
      message: `${unmatched.length} restored binding ${unmatched.length === 1 ? 'file is' : 'files are'} for controllers with device IDs this PC does not use. DCS ignores them until they are moved to the IDs of the controllers attached here. Bindings → Device IDs shows which can be moved and moves them, with a preview.`,
    };
  }
  ctx.log.info(`restored ${id}`, {
    restored: report.restored.length,
    keptBoth: report.keptBoth.length,
    failed: report.failed.length,
  });
  return ok(report);
}

async function restoreOwn(
  ctx: Ctx,
  opened: OpenedArchive,
  entry: RestoreOwnView,
  action: RestoreAction
): Promise<Result<{ keptBoth?: string }>> {
  const keepBoth = action === 'keepBoth' && entry.status === 'different';
  if (entry.kind === 'profile') {
    const id = entry.ref.slice('profile:'.length);
    const source = opened.manifest.rigready.find(
      (f) => f.path.startsWith('profiles/') && parseId(opened, f.path) === id
    );
    if (!source) return err('restore.profile', 'The setup is not in the backup.');
    const profile = parseYamlProfile(opened.data.get(`rigready/${source.path}`)!);
    if (!profile.ok) return profile;
    let next = profile.value;
    if (keepBoth) {
      const name = `${profile.value.name} (restored)`.slice(0, 80);
      next = { ...profile.value, id: await ctx.profiles.uniqueId(name), name };
    }
    const saved = await ctx.profiles.save(next);
    if (!saved.ok) return saved;
    const back = await ctx.profiles.get(next.id);
    if (!back.ok) return back;
    return ok(keepBoth ? { keptBoth: `Saved as "${next.name}"` } : {});
  }
  if (entry.kind === 'layout') {
    const file = opened.data.get('rigready/displays/layouts.json')!;
    const layout = parseJson(file, LayoutsFileSchema)?.layouts.find(
      (l) => l.id === entry.ref.slice('layout:'.length)
    );
    if (!layout) return err('restore.layout', 'The monitor layout is not in the backup.');
    const current = await ctx.layouts.list();
    if (!current.ok) return current;
    const existing = current.value.find((l) => l.id === layout.id);
    if (existing && !keepBoth) {
      const replaced = await ctx.layouts.replace(layout.id, layout.displays);
      if (!replaced.ok) return replaced;
      if (existing.name !== layout.name) {
        const renamed = await ctx.layouts.rename(layout.id, layout.name);
        if (!renamed.ok) return renamed;
      }
      return ok({});
    }
    const taken = current.value.some((l) => l.name.toLowerCase() === layout.name.toLowerCase());
    const name = keepBoth || taken ? `${layout.name} (restored)`.slice(0, 60) : layout.name;
    const created = await ctx.layouts.create(name, layout.displays);
    if (!created.ok) return created;
    return ok(name === layout.name ? {} : { keptBoth: `Saved as "${name}"` });
  }
  if (entry.kind === 'settings') {
    const parsed = parseJson(opened.data.get('rigready/settings.json')!, AppSettingsSchema);
    if (!parsed) return err('restore.settings', 'The settings in the backup are not valid.');
    const updated = await ctx.settings.update({
      deskLayoutId: parsed.deskLayoutId ?? null,
      minimizeToTray: parsed.minimizeToTray,
      retention: parsed.retention,
      displayRevertSeconds: parsed.displayRevertSeconds,
      checkTimeoutSeconds: parsed.checkTimeoutSeconds,
      importMaxMegabytes: parsed.importMaxMegabytes,
    });
    return updated.ok ? ok({}) : updated;
  }
  const parsed = parseJson(opened.data.get('rigready/backup/tracked.json')!, TrackedFileSchema);
  if (!parsed)
    return err('restore.tracked', 'The "Always back up" list in the backup is not valid.');
  const merged = await globalStore(ctx).update((current) => {
    const items = [...current.items];
    for (const item of parsed.items) {
      if (items.some((i) => sameItem(i, item))) continue;
      let id = item.id;
      for (let n = 2; items.some((i) => i.id === id); n++) id = `${item.id.slice(0, 60)}-${n}`;
      items.push({ ...item, id });
    }
    return { ...current, items };
  });
  return merged.ok ? ok({}) : merged;
}

function parseId(opened: OpenedArchive, file: string): string | undefined {
  const profile = parseYamlProfile(opened.data.get(`rigready/${file}`)!);
  return profile.ok ? profile.value.id : file.slice('profiles/'.length, -'.yaml'.length);
}
