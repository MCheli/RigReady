import path from 'node:path';
import * as yaml from 'js-yaml';
import { credentialReason, isProgramFile } from '../../../core/credentials';
import { sha256 } from '../../../core/files/fileStore';
import { createZip, type ZipEntry } from '../../../core/files/zip';
import { profileExtension, ProfileSchema, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { BACKUP_EXTENSION, BackupExtensionSchema, resolveTrackedItem } from '../../../core/tracked';
import {
  BUNDLE_EXTENSION,
  BUNDLE_FILTER,
  privacyContext,
  type BundleManifest,
  type Ctx,
} from './bundle';
import { notesFor, requirementsOf, type Compatibility } from './compat';
import { Scanner, transformValue, type Decision, type Finding } from './privacy';
import { stripRunnable, type StrippedItem } from './strip';

export interface ExportOptions {
  profileId: string;
  /** Ids of the setup's tracked items whose files go along. */
  includeItems: string[];
}

export interface ShareableItem {
  id: string;
  label: string;
  path: string;
  fileCount: number;
  totalBytes: number;
  problem?: string;
}

export interface ExportReview {
  profileName: string;
  game?: string;
  items: ShareableItem[];
  findings: Finding[];
  stripped: StrippedItem[];
  excluded: { path: string; reason: string }[];
  files: { group: string; path: string; size: number }[];
  compatibility: Compatibility;
  /** Generated notes, editable by the user. */
  notes: string;
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const GUID = /\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/i;

interface Built {
  review: ExportReview;
  profile: Profile;
  entries: ZipEntry[];
  manifest: Omit<BundleManifest, 'notes' | 'appVersion' | 'createdAt'>;
}

/**
 * Everything a shared setup would contain, with every personal detail found. With
 * `decisions`, removed details are replaced and the archive entries are built.
 */
async function build(
  ctx: Ctx,
  options: ExportOptions,
  decisions: Record<string, Decision> | undefined
): Promise<Result<Built>> {
  const loaded = await ctx.profiles.get(options.profileId);
  if (!loaded.ok) return loaded;
  const { profile: clean, stripped } = stripRunnable(loaded.value);
  const extension = profileExtension(clean, BACKUP_EXTENSION, BackupExtensionSchema);
  const tracked = extension?.items ?? [];
  const serials = clean.checks
    .map((c) => c.params['serial'])
    .filter((s): s is string => typeof s === 'string');
  const privacy = await privacyContext(ctx, serials);
  const scanner = new Scanner(privacy);
  const decide = (finding: Finding): Decision => decisions?.[finding.id] ?? finding.defaultAction;

  // The setup itself.
  const titled = (trail: string[]): string => {
    if (trail[0] === 'checks' && trail[1] !== undefined) {
      const check = clean.checks[Number(trail[1])];
      return check ? `Setup: "${check.title}"` : 'Setup';
    }
    return 'Setup';
  };
  const profileValue = transformValue(clean, scanner, titled, decide);
  const profile = ProfileSchema.safeParse(profileValue);
  if (!profile.success) return err('share.profile', 'The setup could not be prepared for sharing.');

  // Its config files.
  const items: ShareableItem[] = [];
  const excluded: ExportReview['excluded'] = [];
  const files: ExportReview['files'] = [];
  const entries: ZipEntry[] = [];
  const groups: BundleManifest['groups'] = [];
  for (const item of tracked) {
    const resolved = await resolveTrackedItem(ctx.ports.files, item, privacy.variables);
    items.push({
      id: item.id,
      label: item.label,
      path: item.path,
      fileCount: resolved.files.length,
      totalBytes: resolved.files.reduce((sum, f) => sum + f.size, 0),
      ...(resolved.problem ? { problem: resolved.problem } : {}),
    });
    if (!options.includeItems.includes(item.id)) continue;
    for (const w of resolved.withheld) {
      excluded.push({ path: `${item.path}/${w.relativePath}`, reason: `Credentials: ${w.reason}` });
    }
    const group: BundleManifest['groups'][number] = {
      label: item.label,
      path: item.path,
      kind: item.kind,
      files: [],
    };
    const index = groups.length;
    for (const file of resolved.files) {
      const where = `${item.label} / ${file.relativePath}`;
      if (isProgramFile(file.path)) {
        excluded.push({ path: `${item.path}/${file.relativePath}`, reason: 'Program or script' });
        continue;
      }
      if (credentialReason(file.path, privacy.variables)) continue;
      const guid = GUID.exec(file.relativePath);
      if (guid) {
        const finding = scanner.add(
          {
            kind: 'deviceId',
            value: path.basename(file.relativePath).replace(/\.diff\.lua$/i, ''),
            removeText: 'File left out',
            defaultAction: 'keep',
          },
          where
        );
        if (decide(finding) === 'remove') continue;
      }
      const bytes = await ctx.ports.files.readBytes(file.path);
      if (!bytes.ok) {
        excluded.push({ path: `${item.path}/${file.relativePath}`, reason: 'Could not be read' });
        continue;
      }
      let data = bytes.value;
      let tokens = false;
      let text: string | undefined;
      try {
        text = data.includes(0) ? undefined : decoder.decode(data);
      } catch {
        // Not UTF-8: a binary file, which is listed as "not checked" below.
        text = undefined;
      }
      if (text === undefined) {
        const finding = scanner.add(
          {
            kind: 'unchecked',
            value: `${item.label} / ${file.relativePath}`,
            removeText: 'File left out',
            defaultAction: 'keep',
          },
          where
        );
        if (decide(finding) === 'remove') continue;
      } else {
        const next = scanner.transform(text, where, 'file', decide);
        if (next !== text) {
          data = new TextEncoder().encode(next);
          tokens = next.includes('%RIGREADY:');
        }
      }
      entries.push({ path: `files/${index}/${file.relativePath}`, data });
      group.files.push({
        path: file.relativePath,
        size: data.length,
        sha256: sha256(data),
        tokens,
      });
      files.push({ group: item.label, path: file.relativePath, size: data.length });
    }
    groups.push(group);
  }

  const compatibility = await requirementsOf(ctx, profile.data);
  const profileYaml = new TextEncoder().encode(
    yaml.dump(profile.data, { noRefs: true, lineWidth: 120 })
  );
  entries.unshift({ path: 'profile.yaml', data: profileYaml });
  // The monitor arrangement of its layout check, so the importer can save it as a named layout.
  const layoutCheck = profile.data.checks.find((c) => Array.isArray(c.params['displays']));
  let layout: BundleManifest['layout'];
  if (layoutCheck) {
    const data = new TextEncoder().encode(
      JSON.stringify(
        { name: `${profile.data.name} monitors`, displays: layoutCheck.params['displays'] },
        null,
        2
      )
    );
    entries.push({ path: 'layout.json', data });
    layout = { sha256: sha256(data) };
  }
  const review: ExportReview = {
    profileName: profile.data.name,
    ...(profile.data.game ? { game: profile.data.game } : {}),
    items,
    findings: scanner.list(),
    stripped,
    excluded,
    files,
    compatibility,
    notes: notesFor(profile.data.name, compatibility),
  };
  return ok({
    review,
    profile: profile.data,
    entries,
    manifest: {
      format: 'rigready-setup',
      schemaVersion: 1,
      name: profile.data.name,
      ...(profile.data.game ? { game: profile.data.game } : {}),
      compatibility,
      stripped,
      excluded,
      profile: { sha256: sha256(profileYaml) },
      ...(layout ? { layout } : {}),
      groups,
    },
  });
}

/** What sharing this setup would contain and every personal detail found, before anything is written. */
export async function prepareExport(
  ctx: Ctx,
  options: ExportOptions
): Promise<Result<ExportReview>> {
  const built = await build(ctx, options, undefined);
  return built.ok ? ok(built.value.review) : built;
}

/** Writes the .rigready file to a place the user picks. Resolves with null when cancelled. */
export async function writeExport(
  ctx: Ctx,
  options: ExportOptions & {
    decisions: Record<string, Decision>;
    notes: string;
    appVersion: string;
  }
): Promise<Result<{ path: string; size: number } | null>> {
  const built = await build(ctx, options, options.decisions);
  if (!built.ok) return built;
  const manifest: BundleManifest = {
    ...built.value.manifest,
    appVersion: options.appVersion,
    createdAt: ctx.ports.clock.now().toISOString(),
    notes: options.notes.slice(0, 10_000),
  };
  // The notes are the user's own words, but they are checked like everything else.
  const scanner = new Scanner(await privacyContext(ctx));
  manifest.notes = scanner.transform(manifest.notes, 'Notes', 'profile', (f) =>
    options.decisions[f.id] === 'keep' ? 'keep' : f.defaultAction
  );
  const zipped = createZip([
    { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    ...built.value.entries,
  ]);
  if (!zipped.ok) return zipped;
  const safeName = built.value.profile.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Setup';
  const target = await ctx.ports.dialogs.save({
    title: 'Share setup',
    defaultPath: path.join(ctx.ports.folders.documents(), `${safeName}.${BUNDLE_EXTENSION}`),
    filters: BUNDLE_FILTER,
  });
  if (!target.ok) return target;
  if (target.value === null) return ok(null);
  const file = /\.rigready$/i.test(target.value)
    ? target.value
    : `${target.value}.${BUNDLE_EXTENSION}`;
  const written = await ctx.ports.files.write(file, zipped.value, {
    reason: `Share setup ${built.value.profile.name}`,
  });
  if (!written.ok) return written;
  const back = await ctx.ports.files.readBytes(file);
  if (!back.ok || sha256(back.value) !== sha256(zipped.value)) {
    return err('share.write', `The file at ${file} does not match what was written.`);
  }
  ctx.log.info(`shared ${options.profileId}`, { file, bytes: zipped.value.length });
  return ok({ path: file, size: zipped.value.length });
}
