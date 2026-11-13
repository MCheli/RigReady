import path from 'node:path';
import type { MainContext } from '../../../core/feature';
import { sha256 } from '../../../core/files/fileStore';
import { loadDataYaml } from '../../../core/files/yaml';
import { allPathVariables, collapsePath, type PathVariables } from '../../../core/pathVariables';
import { madeByVersionOne } from '../../../core/profile/earlier';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { DeviceInfo, LaunchTarget } from '../../../shared/models';
import type { EarlierPlan, NewProfile } from '../contract';
import { broughtOverFiles } from './brought';
import { createProfile } from './profiles';

/**
 * Bringing a setup over from RigReady 1. Version 1 (1.0 and 1.1, src/shared/profileTypes.ts
 * at the v1.1.0 tag) wrote `profiles/<id>.yaml` with a name, a game, an optional launch
 * target and a list of checklist items, each `{ type, name, isRequired, config,
 * remediation? }`. Each part is turned into the one of this version that does exactly the
 * same, or it is not brought over and the user is told why before anything is written:
 *
 * - process: "<image> is running", and its "launch the program" fix (same program and
 *   arguments) or its "tell the user" fix.
 * - device by vendor and product number: "connected", by the same numbers. By name only
 *   (version 1 matched the name the device reports): the one connected device of that name
 *   gives the numbers; when none or several are connected, nothing is guessed.
 * - config file: "file exists", or "file content" with the same regular expression.
 * - display, script and the "restore a file" fix have nothing in this version that does the
 *   same with the information the file holds, and are left out.
 *
 * The old file is only read. Nothing is written until the user says so, and then only the
 * new setup, through the same path as New setup from this rig.
 */
type Ctx = Pick<MainContext, 'ports' | 'profiles' | 'checks' | 'games' | 'log' | 'backupSources'>;
type Proposed = Omit<CheckItem, 'id'>;

/** Version 1's game names, and the game modules each can mean. */
const GAMES: Record<string, string[]> = {
  dcs: ['dcs'],
  iracing: ['iracing'],
  beamng: ['beamng'],
  lmu: ['lmu'],
  acc: ['acc'],
  il2: ['il2-great-battles'],
  msfs: ['msfs2024', 'msfs2020'],
  xplane: ['x-plane-12', 'x-plane-11'],
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const strings = (value: unknown): string[] | undefined =>
  value === undefined
    ? []
    : Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? (value as string[])
      : undefined;
const hex = (value: unknown): string | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff
    ? value.toString(16).toUpperCase().padStart(4, '0')
    : undefined;
const isAbsolute = (file: string): boolean => /^[a-z]:[\\/]/i.test(file);

interface Planned {
  view: EarlierPlan;
  setup?: NewProfile;
}

interface Part {
  title: string;
  check?: Proposed;
  what?: string;
  /** Not brought over, and never will be: what it was and why. */
  left?: string;
  /** Not brought over now: what would let RigReady do it. */
  blocked?: string;
}

/** A fix of version 1, as one of this version, or why it has none. */
function fixOf(
  remediation: unknown,
  variables: PathVariables
): { fix?: Proposed['remediation']; what?: string; why?: string } {
  const fix = record(remediation);
  if (!fix) return {};
  const config = record(fix['config']) ?? {};
  if (fix['type'] === 'launchProcess') {
    const exe = text(config['executablePath']);
    const args = strings(config['arguments']);
    if (!exe || !isAbsolute(exe) || !args)
      return { why: 'its "start the program" fix has no full path' };
    return {
      fix: { type: 'process.launch', params: { exe: collapsePath(exe, variables), args } },
      what: `starts ${path.win32.basename(exe)}`,
    };
  }
  if (fix['type'] === 'notifyUser') {
    const words = [text(config['message']), text(config['instructions'])].filter(Boolean);
    if (words.length === 0) return { why: 'its "show what to do" fix has no words' };
    return {
      fix: { type: 'instructions.show', params: { text: words.join('\n\n').slice(0, 10_000) } },
      what: 'shows what to do',
    };
  }
  if (fix['type'] === 'restoreConfig') {
    return {
      why: 'RigReady 1 copied a file of your own over it, and this version puts back only copies it kept itself. Add "Put back the copy" in the editor once RigReady has a copy',
    };
  }
  return { why: `its fix "${String(fix['type'])}" has no match in this version` };
}

function partOf(item: unknown, devices: DeviceInfo[], variables: PathVariables): Part {
  const entry = record(item) ?? {};
  const config = record(entry['config']) ?? {};
  const title = (text(entry['name']) ?? 'A check without a name').slice(0, 120);
  const required = entry['isRequired'] !== false;
  const fix = fixOf(entry['remediation'], variables);
  const withFix = (check: Proposed, what: string): Part => {
    if (fix.why) return { title, left: `${fix.why.charAt(0).toUpperCase()}${fix.why.slice(1)}.` };
    return {
      title,
      check: { ...check, ...(fix.fix ? { remediation: fix.fix } : {}) },
      what: fix.what ? `${what}; the fix ${fix.what}` : what,
    };
  };
  switch (entry['type']) {
    case 'process': {
      const name = text(config['processName']);
      if (!name || !/\.exe$/i.test(name) || /[\\/]/.test(name)) {
        return { title, left: 'It does not name a program (an .exe).' };
      }
      return withFix(
        { type: 'process.running', title, required, params: { name } },
        `${name} is running`
      );
    }
    case 'device': {
      const vendorId = hex(config['vendorId']);
      const productId = hex(config['productId']);
      if (vendorId && productId) {
        return withFix(
          { type: 'device.connected', title, required, params: { vendorId, productId } },
          `connected (${vendorId}:${productId})`
        );
      }
      const name = text(config['deviceName']);
      if (!name) {
        return {
          title,
          left: 'RigReady 1 checked any device of one maker, and this version checks one device.',
        };
      }
      const named = devices.filter(
        (d) => !d.isHub && d.name.toLowerCase().includes(name.toLowerCase())
      );
      const models = new Set(named.map((d) => `${d.vendorId}:${d.productId}`));
      if (models.size === 0) {
        return {
          title,
          blocked: `RigReady 1 knew it only by its name, "${name}", and no device of that name is connected now. Connect it, then look again.`,
        };
      }
      if (models.size > 1) {
        return {
          title,
          blocked: `RigReady 1 knew it only by its name, "${name}", and ${models.size} different devices of that name are connected. Unplug the ones it is not, then look again.`,
        };
      }
      const [found] = named;
      return withFix(
        {
          type: 'device.connected',
          title,
          required,
          params: { vendorId: found!.vendorId, productId: found!.productId },
        },
        `connected: the ${found!.name} plugged in now (${found!.vendorId}:${found!.productId})`
      );
    }
    case 'config': {
      const file = text(config['filePath']);
      if (!file || !isAbsolute(file)) {
        return { title, left: 'It has no full path to the file.' };
      }
      const stored = collapsePath(file, variables);
      const pattern = text(config['contentRegex']);
      if (pattern !== undefined) {
        let invalid: string | undefined;
        try {
          new RegExp(pattern);
        } catch (e) {
          invalid = e instanceof Error ? e.message : String(e);
        }
        if (invalid !== undefined) {
          return { title, left: `Its pattern is not valid (${invalid}).` };
        }
        return withFix(
          {
            type: 'file.content',
            title,
            required,
            params: { path: stored, rule: 'regex', value: pattern },
          },
          `${path.win32.basename(file)} matches ${pattern}`
        );
      }
      return withFix(
        { type: 'file.exists', title, required, params: { path: stored, kind: 'file' } },
        `${path.win32.basename(file)} exists`
      );
    }
    case 'display':
      return {
        title,
        left: 'RigReady 1 kept its monitor layouts in a form this version cannot match to your monitors. Arrange them, then save the layout on the Monitors page and add a "Monitor layout" check in the editor.',
      };
    case 'script':
      return {
        title,
        left: 'RigReady 1 only looked for the script file and never ran it. Add a "Script succeeds" check in the editor if you want it run.',
      };
    default:
      return {
        title,
        left: `A check of a kind this version does not know (${String(entry['type'])}).`,
      };
  }
}

/** The check and fix types must take these params, as the setup editor would. */
function valid(ctx: Ctx, check: Proposed): boolean {
  const type = ctx.checks.check(check.type);
  if (!type?.params.safeParse(check.params).success) return false;
  if (!check.remediation) return true;
  return (
    ctx.checks.remediation(check.remediation.type)?.params.safeParse(check.remediation.params)
      .success === true
  );
}

/** The game module version 1's game name means on this PC, or why it cannot tell. */
async function gameOf(ctx: Ctx, game: unknown): Promise<{ id?: string; note?: string }> {
  const named = text(game);
  if (!named || named === 'other') return {};
  const options = (GAMES[named] ?? []).filter((id) => ctx.games.get(id) !== undefined);
  if (options.length === 1) return { id: options[0]! };
  if (options.length === 0)
    return {
      note: `RigReady 1 called the game "${named}", which this version does not know. The setup is brought over without a game; choose it in the editor.`,
    };
  const installed: string[] = [];
  for (const id of options) {
    const found = await ctx.games.get(id)!.detect(ctx);
    if (found.ok && found.value.length > 0) installed.push(id);
  }
  if (installed.length === 1) return { id: installed[0]! };
  const names = options.map((id) => ctx.games.get(id)!.name).join(' or ');
  return {
    note: `RigReady 1 called the game "${named}", which can be ${names}. The setup is brought over without a game; choose it in the editor.`,
  };
}

const steamApp = (launch: LaunchTarget): string | undefined =>
  path.win32.basename(launch.exe).toLowerCase() === 'steam.exe' && launch.args[0] === '-applaunch'
    ? launch.args[1]
    : undefined;

/** The plan for one file RigReady 1 left in the profiles folder, without writing anything. */
export async function planEarlier(ctx: Ctx, id: string): Promise<Result<Planned>> {
  const raw = await ctx.profiles.readRaw(id);
  if (!raw.ok) return raw;
  let parsed: unknown;
  try {
    parsed = loadDataYaml(raw.value);
  } catch (e) {
    return err('profile.yaml', `${id}.yaml is not valid YAML.`, String(e));
  }
  const earlier = madeByVersionOne(parsed);
  const file = record(parsed);
  if (!earlier || !file)
    return err('profile.notEarlier', `${id}.yaml is not a setup RigReady 1 made.`);
  const fileName = path.basename(ctx.profiles.fileFor(id));
  const name = (earlier.name ?? 'Setup from RigReady 1').slice(0, 80);

  const variables = await allPathVariables(ctx, ctx.games);
  const listed = await ctx.ports.devices.list();
  const devices = listed.ok ? listed.value : [];
  const parts = (Array.isArray(file['checklistItems']) ? file['checklistItems'] : []).map((item) =>
    partOf(item, devices, variables)
  );
  for (const part of parts) {
    if (part.check && !valid(ctx, part.check)) {
      part.left = 'This version would not accept it as it is.';
      delete part.check;
    }
  }
  if (!listed.ok && parts.some((p) => p.blocked)) {
    for (const part of parts)
      if (part.blocked) part.blocked = `The devices could not be read: ${listed.error.message}`;
  }

  const notes: string[] = [];
  const game = await gameOf(ctx, file['game']);
  if (game.note) notes.push(game.note);
  const module = game.id ? ctx.games.get(game.id) : undefined;

  // What Launch starts: the program version 1 named, else the game as it is found here.
  const blocked = parts.filter((p) => p.blocked).map((p) => ({ title: p.title, why: p.blocked! }));
  let launch: LaunchTarget | undefined;
  let launchWords: string | undefined;
  const target = record(file['launchTarget']);
  if (target) {
    const exe = text(target['executablePath']);
    const args = strings(target['arguments']);
    const cwd = text(target['workingDirectory']);
    if (!exe || !isAbsolute(exe) || !args || (cwd !== undefined && !isAbsolute(cwd))) {
      blocked.push({
        title: 'What Launch starts',
        why: 'RigReady 1 named a program without a full path. Choose it in New setup from this rig.',
      });
    } else {
      launch = {
        exe: collapsePath(exe, variables),
        args,
        ...(cwd ? { cwd: collapsePath(cwd, variables) } : {}),
      };
      launchWords = path.win32.basename(exe);
    }
    const scripts = [target['preScripts'], target['postScripts']].flatMap((s) =>
      Array.isArray(s) ? s : []
    );
    if (scripts.length > 0) {
      notes.push(
        `RigReady 1 ran ${scripts.length === 1 ? 'a script' : `${scripts.length} scripts`} around the launch. ${scripts.length === 1 ? 'It is' : 'They are'} not brought over: add ${scripts.length === 1 ? 'it' : 'them'} in the editor under "Before launch" or "After launch", where RigReady shows each one before it runs.`
      );
    }
  } else if (module) {
    const installs = await module.detect(ctx);
    const first = installs.ok ? installs.value.find((i) => i.launch) : undefined;
    if (first?.launch) {
      launch = first.launch;
      launchWords = steamApp(first.launch)
        ? `${module.name}, through Steam`
        : `${module.name} (${path.win32.basename(first.launch.exe)})`;
    } else {
      notes.push(
        `${module.name} is not found on this PC, so the setup has nothing to launch yet. Choose what Launch starts in the editor.`
      );
    }
  }
  const tracked = Array.isArray(file['trackedConfigurations']) ? file['trackedConfigurations'] : [];
  if (tracked.length > 0) {
    notes.push(
      `RigReady 1 kept ${tracked.length === 1 ? 'one file' : `${tracked.length} files`} for backup with it. Backups work differently now: add them on the Backups page.`
    );
  }

  const brought = parts.filter((p) => p.check);
  const already = await broughtOverAs(ctx, fileName);
  const shown: Omit<EarlierPlan, 'seen'> = {
    id,
    file: ctx.profiles.fileFor(id),
    name,
    setupName: name,
    ...(module ? { gameName: module.name } : {}),
    ...(launchWords ? { launch: launchWords } : {}),
    checks: brought.map((p) => ({
      title: p.title,
      what: p.what ?? '',
      required: p.check!.required,
    })),
    left: parts.filter((p) => p.left).map((p) => ({ title: p.title, why: p.left! })),
    blocked,
    notes,
    ...(already ? { broughtOver: { id: already.id, name: already.name } } : {}),
    canBringOver: !already && blocked.length === 0 && (brought.length > 0 || launch !== undefined),
  };
  const setup: NewProfile | undefined = shown.canBringOver
    ? {
        name,
        checks: brought.map((p) => p.check!),
        ...(module ? { game: module.id } : {}),
        ...(launch ? { launch } : {}),
      }
    : undefined;
  // What the user is shown and what Bring it over would write, as one fingerprint.
  const view: EarlierPlan = { ...shown, seen: sha256(JSON.stringify({ shown, setup })) };
  return ok(setup ? { view, setup } : { view });
}

/** The setup that was brought over from this file, when there is one. */
async function broughtOverAs(ctx: Ctx, fileName: string): Promise<Profile | undefined> {
  const listed = await ctx.profiles.list();
  return listed.ok ? broughtOverFiles(listed.value).get(fileName) : undefined;
}

/**
 * Makes the setup the plan shows, through the same path as New setup from this rig. The
 * plan is made again here, from the file as it is now: nothing the window sends is used
 * but `seen`, the fingerprint of the plan it showed. When the plan made now is another (a
 * device of that name plugged in or out meanwhile), nothing is made. The old file is not
 * touched.
 */
export async function bringOverEarlier(
  ctx: Ctx,
  id: string,
  seen?: string
): Promise<Result<Profile>> {
  const planned = await planEarlier(ctx, id);
  if (!planned.ok) return planned;
  const { view, setup } = planned.value;
  if (seen !== undefined && seen !== view.seen) {
    return err(
      'profile.earlierChanged',
      `What "${view.name}" would bring over changed since it was shown, so no setup was made. Look at it again.`
    );
  }
  if (view.broughtOver) {
    return err(
      'profile.earlierDone',
      `"${view.name}" was brought over already, as "${view.broughtOver.name}".`
    );
  }
  if (!setup) {
    return err(
      'profile.earlierBlocked',
      `RigReady cannot bring "${view.name}" over.`,
      [...view.blocked, ...view.left].map((p) => `${p.title}: ${p.why}`).join('\n') ||
        'Nothing in it has a match in this version.'
    );
  }
  return createProfile(ctx, setup, {
    extensions: { profiles: { broughtFrom: path.basename(ctx.profiles.fileFor(id)) } },
  });
}
