import path from 'node:path';
import { commandArgs, parseCommandLine } from '../../../core/commandLine';
import type { MainContext } from '../../../core/feature';
import { changePreview, type PlannedWrite } from '../../../core/files/preview';
import type { ShortcutLink } from '../../../core/ports';
import type { Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { ChangePreview } from '../../../shared/changePreview';
import type { ShortcutStatus } from '../contract';

/**
 * A desktop shortcut per setup: "<setup name> - RigReady.lnk" starts RigReady with
 * `--launch=<setup id>` (`--make-ready` for a setup that launches nothing), so flying is one
 * double-click. The file is put on the desktop through FileStore like every change outside
 * RigReady's folder (backed up first, undone from the Safety page), and it is reported as
 * made only after it was read back and found to start this setup.
 */

type Ctx = Pick<MainContext, 'ports' | 'profiles'>;

export const SHORTCUT_SUFFIX = ' - RigReady.lnk';
/** A desktop with more RigReady shortcuts than this: the first ones are enough to find ours. */
const MOST_SHORTCUTS_READ = 60;

/** Names Windows keeps for devices: a file may not be called one of these. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const NOT_IN_A_FILE_NAME = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

/**
 * The file name of a setup's shortcut. A setup name may hold characters a file name cannot
 * ("DCS F/A-18C"): each becomes a dash.
 */
export function shortcutFileName(setupName: string): string {
  let base = [...setupName]
    .map((ch) => (NOT_IN_A_FILE_NAME.has(ch) || ch.charCodeAt(0) < 32 ? '-' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    // Windows drops dots and spaces at the end of a name.
    .replace(/[. ]+$/, '');
  if (base.length === 0 || RESERVED.test(base)) base = `Setup ${base}`.trim();
  return `${base}${SHORTCUT_SUFFIX}`;
}

const canLaunch = (profile: Profile): boolean =>
  profile.launch !== undefined || profile.steamAppId !== undefined;

/** The link a setup's shortcut must be: this copy of RigReady, asked to fly the setup. */
export function expectedLink(ctx: Pick<Ctx, 'ports'>, profile: Profile): ShortcutLink {
  const self = ctx.ports.shortcuts.self();
  const launches = canLaunch(profile);
  return {
    target: self.exe,
    args: [
      ...self.args,
      ...commandArgs({ action: launches ? 'fly' : 'makeReady', setup: profile.id }),
    ],
    description: launches
      ? `Make the rig ready for ${profile.name} and launch it`
      : `Make the rig ready for ${profile.name}`,
    icon: self.exe,
    // It starts in RigReady's own folder, wherever the shortcut is.
    cwd: path.win32.dirname(self.exe),
  };
}

const samePath = (a: string, b: string): boolean =>
  path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();

const sameArgs = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** True when the link starts the same program with the same arguments. */
export function pointsAt(link: ShortcutLink, expected: ShortcutLink): boolean {
  return samePath(link.target, expected.target) && sameArgs(link.args, expected.args);
}

/** True when a link asks some copy of RigReady to fly, make ready or show this setup. */
function isFor(link: ShortcutLink, profileId: string): boolean {
  const parsed = parseCommandLine(link.args);
  return parsed.kind === 'command' && parsed.command.setup.toLowerCase() === profileId;
}

interface Found {
  profile: Profile;
  expected: ShortcutLink;
  /** Where the shortcut belongs. */
  file: string;
  /** Something has that name already. */
  exists: boolean;
  /** What it says, when it is a shortcut. */
  link?: ShortcutLink;
  /** Other shortcuts on the desktop that are for this setup: it was renamed since. */
  others: string[];
}

async function look(ctx: Ctx, id: string): Promise<Result<Found>> {
  const loaded = await ctx.profiles.get(id);
  if (!loaded.ok) return loaded;
  const profile = loaded.value;
  const desktop = ctx.ports.folders.desktop();
  const file = path.join(desktop, shortcutFileName(profile.name));
  const exists = await ctx.ports.files.exists(file);
  // Something that is not a shortcut may have the name: it is in the way, not ours.
  const read = exists ? await ctx.ports.shortcuts.read(file) : undefined;
  const link = read?.ok ? read.value : undefined;
  const names = await ctx.ports.files.list(desktop);
  if (!names.ok) return names;
  const others: string[] = [];
  const candidates = names.value
    .filter((name) => name.toLowerCase().endsWith(SHORTCUT_SUFFIX.toLowerCase()))
    .filter((name) => !samePath(path.join(desktop, name), file))
    .sort()
    .slice(0, MOST_SHORTCUTS_READ);
  for (const name of candidates) {
    const other = path.join(desktop, name);
    const said = await ctx.ports.shortcuts.read(other);
    if (said.ok && said.value && isFor(said.value, profile.id)) others.push(other);
  }
  return ok({
    profile,
    expected: expectedLink(ctx, profile),
    file,
    exists,
    ...(link ? { link } : {}),
    others,
  });
}

function statusOf(found: Found): ShortcutStatus {
  const { profile, expected, file, exists, link, others } = found;
  const name = path.basename(file);
  const launches = canLaunch(profile);
  const base = { file, name, launches };
  const earlier = `Another shortcut for this setup is on the desktop under its earlier name: ${others
    .map((other) => path.basename(other))
    .join(', ')}.`;
  if (link && pointsAt(link, expected)) {
    if (others.length > 0) return { ...base, state: 'outdated', detail: earlier };
    return {
      ...base,
      state: 'current',
      detail: launches
        ? `Double-click it to make the rig ready for ${profile.name} and launch it.`
        : `Double-click it to make the rig ready for ${profile.name}.`,
    };
  }
  if (link && isFor(link, profile.id)) {
    return {
      ...base,
      state: 'outdated',
      detail: !samePath(link.target, expected.target)
        ? `It starts another copy of RigReady: ${link.target}`
        : launches
          ? 'It was made before this setup had something to launch.'
          : 'It was made when this setup still launched something.',
    };
  }
  if (others.length > 0) return { ...base, state: 'outdated', detail: earlier };
  if (exists) {
    return {
      ...base,
      state: 'taken',
      detail: `${name} is on the desktop already, and it is not a shortcut to this setup.`,
    };
  }
  return { ...base, state: 'none', detail: 'Not on the desktop yet.' };
}

/** Whether the setup has a shortcut on the desktop, and whether it still does what it should. */
export async function shortcutStatus(ctx: Ctx, id: string): Promise<Result<ShortcutStatus>> {
  const found = await look(ctx, id);
  return found.ok ? ok(statusOf(found.value)) : found;
}

interface Plan {
  found: Found;
  planned: PlannedWrite[];
  reason: string;
}

async function plan(ctx: Ctx, id: string, action: 'create' | 'remove'): Promise<Result<Plan>> {
  const looked = await look(ctx, id);
  if (!looked.ok) return looked;
  const found = looked.value;
  const { profile, file, others, link } = found;
  const gone = (target: string): PlannedWrite => ({ path: target, remove: true });
  if (action === 'remove') {
    // Only what is ours: a file that merely has the name is left alone.
    const mine = link && isFor(link, profile.id) ? [file] : [];
    return ok({
      found,
      planned: [...mine, ...others].map(gone),
      reason: `Remove the desktop shortcut of "${profile.name}"`,
    });
  }
  const content = await ctx.ports.shortcuts.build(found.expected);
  if (!content.ok) return content;
  return ok({
    found,
    // The new one, and the ones under an earlier name go.
    planned: [{ path: file, content: content.value }, ...others.map(gone)],
    reason: `Create a desktop shortcut for "${profile.name}"`,
  });
}

/** What making or removing the shortcut would do to the desktop, before anything is written. */
export async function previewShortcut(
  ctx: Ctx,
  id: string,
  action: 'create' | 'remove'
): Promise<Result<ChangePreview>> {
  const planned = await plan(ctx, id, action);
  if (!planned.ok) return planned;
  return changePreview(ctx.ports.files, planned.value.planned);
}

async function apply(ctx: Ctx, { planned, reason }: Plan): Promise<Result<void>> {
  const { files } = ctx.ports;
  const group = files.beginGroup(reason);
  for (const write of planned) {
    const done =
      'remove' in write
        ? await files.remove(write.path, { reason, group })
        : await files.write(write.path, write.content, { reason, group });
    if (!done.ok) return done;
  }
  return ok(undefined);
}

/**
 * Puts the shortcut on the desktop, then reads it back: it is reported as made only when
 * the file is there and starts this RigReady with this setup.
 */
export async function createShortcut(ctx: Ctx, id: string): Promise<Result<ShortcutStatus>> {
  const planned = await plan(ctx, id, 'create');
  if (!planned.ok) return planned;
  const applied = await apply(ctx, planned.value);
  if (!applied.ok) return applied;
  const { file, expected } = planned.value.found;
  const back = await ctx.ports.shortcuts.read(file);
  if (!back.ok) return back;
  if (!back.value) {
    return err(
      'shortcut.notWritten',
      'The shortcut is not on the desktop.',
      `It was written to ${file}, but the file is not there now.`
    );
  }
  if (!pointsAt(back.value, expected)) {
    return err(
      'shortcut.wrong',
      'The shortcut was written, but it does not start this setup.',
      `${file} starts ${[back.value.target, ...back.value.args].join(' ')}`
    );
  }
  const after = await shortcutStatus(ctx, id);
  if (after.ok && after.value.state !== 'current') {
    return err('shortcut.notWritten', 'The shortcut is not as it should be.', after.value.detail);
  }
  return after;
}

/** Removes the setup's shortcut (and one left under an earlier name), then looks again. */
export async function removeShortcut(ctx: Ctx, id: string): Promise<Result<ShortcutStatus>> {
  const planned = await plan(ctx, id, 'remove');
  if (!planned.ok) return planned;
  if (planned.value.planned.length === 0) {
    return err('shortcut.none', 'This setup has no shortcut on the desktop.');
  }
  const applied = await apply(ctx, planned.value);
  if (!applied.ok) return applied;
  for (const write of planned.value.planned) {
    if (await ctx.ports.files.exists(write.path)) {
      return err(
        'shortcut.notRemoved',
        'The shortcut is still on the desktop.',
        `${write.path} could not be removed.`
      );
    }
  }
  return shortcutStatus(ctx, id);
}
