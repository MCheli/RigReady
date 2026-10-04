import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { credentialReason, isProgramFile } from '../../../core/credentials';
import { sameGuid } from '../../../core/directInput';
import { sha256 } from '../../../core/files/fileStore';
import { readZip } from '../../../core/files/zip';
import { inspectZip } from '../../../core/files/zipInspect';
import { isWithin } from '../../../core/paths';
import { allPathVariables, expandPath, variableOf } from '../../../core/pathVariables';
import { ProfileSchema, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { DisplayTargetSchema } from '../../../shared/models';
import {
  BUNDLE_FILTER,
  BundleManifestSchema,
  importRoots,
  type BundleManifest,
  type Ctx,
} from './bundle';
import { compareWithMachine, type CompatibilityReport } from './compat';
import { expandTokens } from './privacy';
import { requireConfirmation, stripRunnable, type StrippedItem } from './strip';

const LayoutSchema = z.object({
  name: z.string().min(1).max(60),
  displays: z.array(DisplayTargetSchema).min(1).max(32),
});

export interface OpenedBundle {
  manifest: BundleManifest;
  profile: Profile;
  /** Runnable parts found in the file despite the sharing rules: dropped. */
  strippedNow: StrippedItem[];
  layout?: z.infer<typeof LayoutSchema>;
  data: Map<string, Uint8Array>;
}

const SAFE_EXTRA = /^(manifest\.json|profile\.yaml|layout\.json)$/;

/**
 * Checks a .rigready file as hostile input, before anything is written: archive limits
 * (size, entry count, links, unsafe names), a valid manifest that lists every file with
 * its checksum, a valid setup, no programs or scripts. Runnable parts of the setup are
 * removed and listed.
 */
export function validateBundle(bytes: Uint8Array, maxTotalBytes: number): Result<OpenedBundle> {
  if (bytes.length > maxTotalBytes) {
    return err(
      'zip.tooBig',
      `The file is larger than ${Math.round(maxTotalBytes / (1024 * 1024))} MB.`
    );
  }
  const inspected = inspectZip(bytes, { maxTotalBytes, maxEntries: 5000 });
  if (!inspected.ok) return inspected;
  const entries = readZip(bytes, { maxTotalBytes, maxEntries: 5000 });
  if (!entries.ok) return entries;
  const data = new Map(entries.value.map((e) => [e.path, e.data]));
  const manifestBytes = data.get('manifest.json');
  if (!manifestBytes)
    return err('share.noManifest', 'This is not a RigReady shared setup (no manifest).');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (e) {
    return err(
      'share.manifest',
      'The shared setup is damaged: its manifest is not valid JSON.',
      String(e)
    );
  }
  const manifest = BundleManifestSchema.safeParse(raw);
  if (!manifest.success) {
    return err('share.manifest', 'The shared setup is not valid.', z.prettifyError(manifest.error));
  }
  const m = manifest.data;
  const declared = new Map<string, string>();
  declared.set('profile.yaml', m.profile.sha256);
  if (m.layout) declared.set('layout.json', m.layout.sha256);
  for (const [i, group] of m.groups.entries()) {
    for (const file of group.files) {
      if (isProgramFile(file.path)) {
        return err('share.program', `The shared setup contains a program or script: ${file.path}`);
      }
      declared.set(`files/${i}/${file.path}`, file.sha256);
    }
  }
  for (const [name, content] of data) {
    if (name === 'manifest.json') continue;
    const hash = declared.get(name);
    if (!hash) {
      return err(
        'share.unexpected',
        SAFE_EXTRA.test(name)
          ? `The shared setup holds ${name} without listing it.`
          : `The shared setup holds a file it does not list: ${name}`
      );
    }
    if (sha256(content) !== hash)
      return err('share.damaged', `A file in the shared setup is damaged: ${name}`);
  }
  for (const name of declared.keys()) {
    if (!data.has(name))
      return err('share.damaged', `A file is missing from the shared setup: ${name}`);
  }
  let profileRaw: unknown;
  try {
    profileRaw = yaml.load(new TextDecoder().decode(data.get('profile.yaml')!));
  } catch (e) {
    return err('share.yaml', 'The setup in the file is not valid YAML.', String(e));
  }
  const profile = ProfileSchema.safeParse(profileRaw);
  if (!profile.success) {
    return err(
      'share.profile',
      'The setup in the file is not valid.',
      z.prettifyError(profile.error)
    );
  }
  let layout: OpenedBundle['layout'];
  if (m.layout) {
    try {
      const parsed = LayoutSchema.safeParse(
        JSON.parse(new TextDecoder().decode(data.get('layout.json')!))
      );
      if (!parsed.success)
        return err('share.layout', 'The monitor layout in the file is not valid.');
      layout = parsed.data;
    } catch {
      return err('share.layout', 'The monitor layout in the file is not valid.');
    }
  }
  const { profile: clean, stripped } = stripRunnable(profile.data);
  return ok({
    manifest: m,
    profile: clean,
    strippedNow: stripped,
    ...(layout ? { layout } : {}),
    data,
  });
}

export interface ImportPart {
  id: string;
  label: string;
  detail: string;
  importable: boolean;
  problem?: string;
  /** For file groups. */
  stored?: string;
  target?: string;
  files?: { path: string; size: number; status: 'new' | 'same' | 'different' }[];
}

export interface ImportReport {
  importId: string;
  fileName: string;
  name: string;
  notes: string;
  createdAt: string;
  appVersion: string;
  compatibility: CompatibilityReport;
  /** Everything the setup wanted to run; none of it is imported. */
  wantedToRun: (StrippedItem & { inFile: boolean })[];
  excluded: { path: string; reason: string }[];
  parts: ImportPart[];
}

const sessions = new Map<string, { bundle: OpenedBundle; fileName: string }>();

interface Plan {
  part: ImportPart;
  /** For file groups: index, target folder, files with targets. */
  group?: {
    index: number;
    files: { path: string; target: string; data: Uint8Array; tokens: boolean }[];
  };
}

async function plan(ctx: Ctx, bundle: OpenedBundle): Promise<Plan[]> {
  const variables = await allPathVariables(ctx, ctx.games);
  const roots = await importRoots(ctx);
  const devices = await ctx.ports.devices.list();
  const present = devices.ok ? devices.value : [];
  const missing = bundle.profile.checks.filter((c) => {
    const v = c.params['vendorId'];
    const p = c.params['productId'];
    return (
      typeof v === 'string' &&
      typeof p === 'string' &&
      !present.some((d) => d.vendorId === v.toUpperCase() && d.productId === p.toUpperCase())
    );
  });
  const plans: Plan[] = [
    {
      part: {
        id: 'profile',
        label: `Setup "${bundle.manifest.name}"`,
        detail:
          `${bundle.profile.checks.length} checks` +
          (missing.length
            ? `; ${missing.length} for devices not found here are kept, switched off and marked "device not found"`
            : ''),
        importable: true,
      },
    },
  ];
  if (bundle.layout) {
    plans.push({
      part: {
        id: 'layout',
        label: 'Monitor layout',
        detail: `Saved as "${bundle.layout.name}" with your other layouts`,
        importable: true,
      },
    });
  }
  for (const [index, group] of bundle.manifest.groups.entries()) {
    const id = `group:${index}`;
    const base = { id, label: group.label, stored: group.path };
    const fileCount = `${group.files.length} ${group.files.length === 1 ? 'file' : 'files'}`;
    if (!variableOf(group.path)) {
      plans.push({
        part: {
          ...base,
          detail: fileCount,
          importable: false,
          problem: 'The file names a full path instead of a known folder.',
        },
      });
      continue;
    }
    const expanded = expandPath(group.path, variables);
    if (!expanded.ok) {
      plans.push({
        part: {
          ...base,
          detail: fileCount,
          importable: false,
          problem: `{${variableOf(group.path)}} is not on this PC (the game or tool it belongs to was not found).`,
        },
      });
      continue;
    }
    const target = expanded.value;
    const folder = group.kind === 'file' ? path.dirname(target) : target;
    if (!roots.some((root) => isWithin(root, folder))) {
      plans.push({
        part: {
          ...base,
          target,
          detail: fileCount,
          importable: false,
          problem:
            "It would write outside Documents, Saved Games and the games' own settings folders.",
        },
      });
      continue;
    }
    const files: NonNullable<Plan['group']>['files'] = [];
    const views: NonNullable<ImportPart['files']> = [];
    for (const file of group.files) {
      const fileTarget =
        group.kind === 'file' ? target : path.join(target, ...file.path.split('/'));
      if (credentialReason(fileTarget, variables)) continue;
      let data = bundle.data.get(`files/${index}/${file.path}`)!;
      if (file.tokens)
        data = new TextEncoder().encode(expandTokens(new TextDecoder().decode(data), variables));
      const current = await ctx.ports.files.readBytes(fileTarget);
      const status = !current.ok
        ? 'new'
        : sha256(current.value) === sha256(data)
          ? 'same'
          : 'different';
      files.push({ path: file.path, target: fileTarget, data, tokens: file.tokens });
      views.push({ path: file.path, size: data.length, status });
    }
    plans.push({
      part: { ...base, target, detail: fileCount, importable: files.length > 0, files: views },
      group: { index, files },
    });
  }
  return plans;
}

/** Opens a .rigready file the user picks and reports what it holds and how it fits this PC. */
export async function openImport(ctx: Ctx): Promise<Result<ImportReport | null>> {
  const picked = await ctx.ports.dialogs.open({
    title: 'Import a shared setup',
    filters: BUNDLE_FILTER,
  });
  if (!picked.ok) return picked;
  const file = picked.value[0];
  if (!file) return ok(null);
  const settings = await ctx.settings.get();
  const cap = (settings.ok ? settings.value.importMaxMegabytes : 200) * 1024 * 1024;
  const stat = await ctx.ports.files.stat(file);
  if (!stat.ok) return stat;
  if (!stat.value) return err('share.missing', `The file is gone: ${file}`);
  if (stat.value.size > cap) {
    return err('zip.tooBig', `The file is larger than ${Math.round(cap / (1024 * 1024))} MB.`);
  }
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) return bytes;
  const bundle = validateBundle(bytes.value, cap);
  if (!bundle.ok) return bundle;
  const importId = sha256(`${file}|${ctx.ports.clock.now().getTime()}|${sessions.size}`).slice(
    0,
    16
  );
  sessions.set(importId, { bundle: bundle.value, fileName: path.basename(file) });
  while (sessions.size > 3) sessions.delete(sessions.keys().next().value!);
  return report(ctx, importId);
}

async function report(ctx: Ctx, importId: string): Promise<Result<ImportReport>> {
  const session = sessions.get(importId);
  if (!session) return err('share.session', 'Open the file again: this import is no longer open.');
  const { bundle } = session;
  const m = bundle.manifest;
  const plans = await plan(ctx, bundle);
  return ok({
    importId,
    fileName: session.fileName,
    name: m.name,
    notes: m.notes,
    createdAt: m.createdAt,
    appVersion: m.appVersion,
    compatibility: await compareWithMachine(ctx, m.compatibility),
    wantedToRun: [
      ...m.stripped.map((s) => ({ ...s, inFile: false })),
      ...bundle.strippedNow.map((s) => ({ ...s, inFile: true })),
    ],
    excluded: m.excluded,
    parts: plans.map((p) => p.part),
  });
}

export interface ImportResult {
  name: string;
  profileId?: string;
  profileName?: string;
  layoutName?: string;
  written: string[];
  unchanged: string[];
  failed: { label: string; reason: string }[];
  groupId?: string;
  deviceIds?: { files: string[]; message: string };
  /** Checks for devices not found on this PC: imported switched off, by title. */
  switchedOff: string[];
}

const profileFile = (ctx: Ctx, id: string): string =>
  path.join(ctx.ports.folders.dataRoot(), 'profiles', `${id}.yaml`);

const GUID_FILE = /\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\.diff\.lua$/i;

/** Imports the chosen parts. Files outside RigReady's folder are written as one undoable action. */
export async function applyImport(
  ctx: Ctx,
  importId: string,
  parts: string[],
  conflict: 'overwrite' | 'keepBoth'
): Promise<Result<ImportResult>> {
  const session = sessions.get(importId);
  if (!session) return err('share.session', 'Open the file again: this import is no longer open.');
  const { bundle } = session;
  const plans = await plan(ctx, bundle);
  const result: ImportResult = {
    name: bundle.manifest.name,
    written: [],
    unchanged: [],
    failed: [],
    switchedOff: [],
  };
  const roots = await importRoots(ctx);
  const group = ctx.ports.files.beginGroup(`Import shared setup "${bundle.manifest.name}"`);
  for (const { part, group: files } of plans) {
    if (!parts.includes(part.id) || !part.id.startsWith('group:')) continue;
    if (!part.importable || !files) {
      result.failed.push({ label: part.label, reason: part.problem ?? 'Not importable' });
      continue;
    }
    for (const file of files.files) {
      let target = file.target;
      const current = await ctx.ports.files.readBytes(target);
      if (current.ok && sha256(current.value) === sha256(file.data)) {
        result.unchanged.push(target);
        continue;
      }
      if (current.ok && conflict === 'keepBoth') {
        const ext = target.toLowerCase().endsWith('.diff.lua') ? '.diff.lua' : path.extname(target);
        const stem = target.slice(0, target.length - ext.length);
        target = `${stem} (shared)${ext}`;
        for (let n = 2; await ctx.ports.files.exists(target); n++)
          target = `${stem} (shared ${n})${ext}`;
      }
      // Never outside the folders an import may touch, whatever the file says.
      const sameFolder =
        path.dirname(target).toLowerCase() === path.dirname(file.target).toLowerCase();
      if (!sameFolder || !roots.some((root) => isWithin(root, target))) {
        result.failed.push({ label: target, reason: 'Outside the folders an import may write to' });
        continue;
      }
      const written = await ctx.ports.files.write(target, file.data, {
        reason: `Import shared setup "${bundle.manifest.name}"`,
        group,
      });
      if (!written.ok) {
        result.failed.push({
          label: target,
          reason: written.error.detail ?? written.error.message,
        });
        continue;
      }
      const back = await ctx.ports.files.readBytes(target);
      if (!back.ok || sha256(back.value) !== sha256(file.data)) {
        result.failed.push({
          label: target,
          reason: 'The file on disk does not match after writing.',
        });
        continue;
      }
      result.written.push(target);
    }
  }
  let journaled = result.written.length > 0;

  if (parts.includes('profile')) {
    const saved = await importProfile(ctx, bundle);
    if (saved.ok) {
      result.profileId = saved.value.id;
      result.profileName = saved.value.name;
      result.switchedOff = saved.value.checks.filter((c) => c.disabled).map((c) => c.title);
      // The new setup belongs to the import: undoing the import removes it too.
      if (await adoptProfile(ctx, saved.value.id, group)) journaled = true;
    } else result.failed.push({ label: 'Setup', reason: saved.error.message });
  }
  if (journaled) result.groupId = group.id;
  if (parts.includes('layout') && bundle.layout) {
    const existing = await ctx.layouts.list();
    const taken =
      existing.ok &&
      existing.value.some((l) => l.name.toLowerCase() === bundle.layout!.name.toLowerCase());
    const name = taken ? `${bundle.layout.name} (shared)`.slice(0, 60) : bundle.layout.name;
    const created = await ctx.layouts.create(name, bundle.layout.displays);
    if (created.ok) result.layoutName = created.value.name;
    else result.failed.push({ label: 'Monitor layout', reason: created.error.message });
  }

  const named = result.written.filter((f) => GUID_FILE.test(path.basename(f)));
  if (named.length > 0) {
    let devices = ctx.ports.input.devices();
    if (devices.length === 0) {
      const started = await ctx.ports.input.start();
      devices = started.ok ? started.value : [];
    }
    const unmatched = named.filter(
      (f) => !devices.some((d) => sameGuid(d.guid, GUID_FILE.exec(path.basename(f))![1]!))
    );
    if (unmatched.length > 0) {
      result.deviceIds = {
        files: unmatched,
        message: `${unmatched.length} imported binding ${unmatched.length === 1 ? 'file is' : 'files are'} for controllers with device IDs this PC does not use. DCS ignores them until they are moved to the IDs of the controllers attached here. Bindings → Device IDs shows which can be moved and moves them, with a preview.`,
      };
    }
  }
  if (result.failed.length === 0) sessions.delete(importId);
  ctx.log.info(`imported ${bundle.manifest.name}`, {
    written: result.written.length,
    failed: result.failed.length,
  });
  return ok(result);
}

/**
 * Makes the setup file an import created part of the import's journal group, as a file
 * that did not exist before: the file just saved is written again through the journal,
 * so that undoing the group removes it. False when that could not be done (the setup
 * stays; only the undo will not cover it).
 */
async function adoptProfile(
  ctx: Ctx,
  id: string,
  group: { id: string; reason: string }
): Promise<boolean> {
  const file = profileFile(ctx, id);
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) return false;
  const removed = await ctx.ports.files.remove(file, { reason: group.reason });
  if (!removed.ok) return false;
  const written = await ctx.ports.files.write(file, bytes.value, {
    reason: group.reason,
    group,
    journal: true,
  });
  if (!written.ok) {
    // Put the setup back as it was saved: it must not be lost to bookkeeping.
    await ctx.ports.files.write(file, bytes.value, { reason: group.reason });
    return false;
  }
  return true;
}

/** Undoes an import: its files are put back and the setup it created is removed. */
export async function undoImport(
  ctx: Ctx,
  groupId: string,
  force: boolean
): Promise<Result<{ files: number; setupRemoved: boolean }>> {
  const groups = await ctx.ports.files.journalGroups();
  if (!groups.ok) return groups;
  const group = groups.value.find((g) => g.id === groupId);
  if (!group || !group.reason.startsWith('Import shared setup')) {
    return err('share.undo', 'That import is no longer in the change journal.');
  }
  const undone = await ctx.ports.files.undoGroup(groupId, { force });
  if (!undone.ok) return undone;
  const profiles = path.join(ctx.ports.folders.dataRoot(), 'profiles');
  const setups = undone.value.entries.filter((e) => isWithin(profiles, e.path));
  let setupRemoved = false;
  for (const entry of setups) {
    if (!(await ctx.ports.files.exists(entry.path))) setupRemoved = true;
  }
  return ok({ files: undone.value.entries.length - setups.length, setupRemoved });
}

async function importProfile(ctx: Ctx, bundle: OpenedBundle): Promise<Result<Profile>> {
  const existing = await ctx.profiles.list();
  const names = new Set((existing.ok ? existing.value : []).map((p) => p.name.toLowerCase()));
  const name = names.has(bundle.profile.name.toLowerCase())
    ? `${bundle.profile.name} (shared)`.slice(0, 80)
    : bundle.profile.name;
  const devices = await ctx.ports.devices.list();
  const present = devices.ok ? devices.value : [];
  const now = ctx.ports.clock.now().toISOString();
  // Stripped once more, then locked: whatever could still run asks first, always.
  const { profile: clean } = requireConfirmation(
    stripRunnable(bundle.profile).profile,
    (type) => ctx.checks.remediation(type)?.confirm !== undefined
  );
  const profile: Profile = {
    ...clean,
    id: await ctx.profiles.uniqueId(name),
    name,
    createdAt: now,
    updatedAt: now,
    checks: clean.checks.map((check) => {
      const v = check.params['vendorId'];
      const p = check.params['productId'];
      if (typeof v !== 'string' || typeof p !== 'string') return check;
      const here = present.some(
        (d) => d.vendorId === v.toUpperCase() && d.productId === p.toUpperCase()
      );
      // Not dropped: switched off, so the setup can be Ready here and the check is one
      // click away when the device arrives.
      return here
        ? check
        : { ...check, disabled: true, title: `${check.title} (device not found)`.slice(0, 200) };
    }),
  };
  const saved = await ctx.profiles.save(profile);
  if (!saved.ok) return saved;
  return ctx.profiles.get(profile.id);
}
