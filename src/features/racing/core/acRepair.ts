import path from 'node:path';
import { changePreview } from '../../../core/files/preview';
import { err, ok, type Result } from '../../../core/result';
import type { ChangePreview } from '../../../shared/changePreview';
import type { InputDevice } from '../../../shared/models';
import { parseIni, type Ini } from './acIni';
import {
  cleanGuid,
  liveControllers,
  locationOf,
  refuseWhileRunning,
  type RacingContext,
} from './context';

/**
 * Assetto Corsa's controls.ini names controllers by number: every binding says JOY=n, and n
 * is the controller's position in the order DirectInput lists the attached game controllers
 * when the game starts. [CONTROLLERS] records what was at each position when the file was
 * saved (CONn name, PGUIDn product GUID, and __IGUIDn instance GUID when Content Manager
 * saved it). When that order changes (another USB port, a device added or removed), JOY=n
 * points at another controller. docs/research/assetto-corsa-controls.md has the sources.
 *
 * This module matches each listed controller to a connected one and rewrites the numbers
 * (and the stored instance GUID) so they point at the same physical controllers again.
 */

export interface AcListed {
  index: number;
  name: string;
  /** Upper case, no braces; empty when the file has no __IGUIDn (the game alone writes none). */
  instanceGuid: string;
  productGuid: string;
  /** PGUIDn exactly as the file has it, written back unchanged. */
  rawProductGuid?: string;
}

/** The controllers [CONTROLLERS] lists, in index order. */
export function listedControllers(ini: Ini): AcListed[] {
  const section = ini.get('CONTROLLERS') ?? new Map<string, { value: string }>();
  const listed: AcListed[] = [];
  for (const [key, entry] of section) {
    const index = /^CON(\d+)$/.exec(key)?.[1];
    if (index === undefined) continue;
    const pguid = section.get(`PGUID${index}`)?.value;
    listed.push({
      index: Number(index),
      name: entry.value,
      instanceGuid: cleanGuid(section.get(`__IGUID${index}`)?.value ?? ''),
      productGuid: cleanGuid(pguid ?? ''),
      ...(pguid !== undefined ? { rawProductGuid: pguid } : {}),
    });
  }
  return listed.sort((a, b) => a.index - b.index);
}

/** The keys that hold a controller number, and the key that says the binding is real. */
const DEVICE_KEYS: { key: string; inputs: string[] }[] = [
  { key: 'JOY', inputs: ['AXLE', 'BUTTON', '__CM_POV'] },
  { key: 'JOY_MODIFICATOR', inputs: ['BUTTON_MODIFICATOR'] },
  // Content Manager's second button for the same action.
  { key: '__CM_ALT_JOY', inputs: ['__CM_ALT_BUTTON', '__CM_ALT_POV'] },
];
const DEVICE_KEY = /^(\s*)(JOY|JOY_MODIFICATOR|__CM_ALT_JOY)(\s*=\s*)(-?\d+)(.*)$/i;

const int = (value: string | undefined): number => Number.parseInt(value ?? '', 10);

/** How many bindings use each controller number. */
export function bindingCounts(ini: Ini): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [name, values] of ini) {
    if (name === 'CONTROLLERS' || name === 'X360') continue;
    for (const { key, inputs } of DEVICE_KEYS) {
      const joy = int(values.get(key)?.value);
      if (!(joy >= 0)) continue;
      const bound =
        inputs.some((input) => int(values.get(input)?.value) >= 0) ||
        // The H-shifter: [SHIFTER] JOY=n with GEAR_1=13, GEAR_R=12, ...
        (key === 'JOY' && [...values].some(([k, v]) => /^GEAR_/.test(k) && int(v.value) >= 0));
      if (bound) counts.set(joy, (counts.get(joy) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * connected: the controller is attached and still at its number. reordered: it is attached,
 * but at another number now. moved: no controller has the stored instance GUID, but one of
 * the same model is attached (a new Windows id; often at another number too). missing:
 * nothing of that model is attached. unknown: the controllers could not be read.
 */
export type AcControllerState = 'connected' | 'reordered' | 'moved' | 'missing' | 'unknown';

export interface AcMatch {
  listed: AcListed;
  state: AcControllerState;
  /** The connected controller RigReady is sure it is now. */
  target?: InputDevice;
  /** The connected controllers of that model it could be, when RigReady is not sure. */
  candidates: InputDevice[];
}

/** The DirectInput collection number in an instance GUID: 20B0BED0-03A4-11F1-8001-... -> "8001". */
const collection = (guid: string): string => cleanGuid(guid).split('-')[3] ?? '';

/** Whether every connected controller says where DirectInput lists it. */
export const orderKnown = (live: InputDevice[]): boolean =>
  live.every((d) => d.enumerationIndex !== undefined);

/**
 * Which connected controller each listed one is now. Sure matches first: the same instance
 * GUID; for an entry without one, a controller of its model still at its number. Then a
 * model that only one unclaimed connected controller has, or (for an entry with an instance
 * GUID) only one with the same collection number. Anything else is left for the user:
 * RigReady never guesses between identical controllers.
 */
export function matchControllers(listed: AcListed[], live: InputDevice[] | undefined): AcMatch[] {
  if (!live) return listed.map((l) => ({ listed: l, state: 'unknown', candidates: [] }));
  const known = orderKnown(live);
  const claimed = new Set<string>();
  const targets = new Map<AcListed, { device: InputDevice; exact: boolean }>();
  const claim = (l: AcListed, device: InputDevice, exact: boolean): void => {
    targets.set(l, { device, exact });
    claimed.add(cleanGuid(device.guid));
  };
  const sameModel = (l: AcListed, d: InputDevice): boolean =>
    l.productGuid
      ? cleanGuid(d.productGuid) === l.productGuid
      : d.name.trim().toLowerCase() === l.name.trim().toLowerCase();
  const open = (l: AcListed): InputDevice[] =>
    live.filter((d) => !claimed.has(cleanGuid(d.guid)) && sameModel(l, d));

  for (const l of listed) {
    if (!l.instanceGuid) continue;
    const device = live.find((d) => cleanGuid(d.guid) === l.instanceGuid);
    if (device && !claimed.has(cleanGuid(device.guid))) claim(l, device, true);
  }
  if (known) {
    for (const l of listed) {
      if (l.instanceGuid || targets.has(l)) continue;
      const at = live.find((d) => d.enumerationIndex === l.index);
      if (at && open(l).includes(at)) claim(l, at, false);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const l of listed) {
      if (targets.has(l)) continue;
      const candidates = open(l);
      const same = l.instanceGuid
        ? candidates.filter((d) => collection(d.guid) === collection(l.instanceGuid))
        : [];
      const sure =
        candidates.length === 1 ? candidates[0] : same.length === 1 ? same[0] : undefined;
      if (sure) {
        claim(l, sure, false);
        changed = true;
      }
    }
  }

  return listed.map((l) => {
    const found = targets.get(l);
    if (!found) {
      const candidates = open(l);
      const state: AcControllerState =
        candidates.length === 0 ? 'missing' : l.instanceGuid ? 'moved' : 'reordered';
      return { listed: l, state, candidates };
    }
    const elsewhere = known && found.device.enumerationIndex !== l.index;
    const state: AcControllerState =
      l.instanceGuid && !found.exact ? 'moved' : elsewhere ? 'reordered' : 'connected';
    return { listed: l, state, target: found.device, candidates: [] };
  });
}

export const needsRepair = (m: AcMatch): boolean => m.state === 'reordered' || m.state === 'moved';

export interface AcChoice {
  /** The controller's number in controls.ini. */
  index: number;
  /** The instance GUID of the connected controller it is now. */
  guid: string;
}

export interface AcRewrite {
  text: string;
  /** Old number -> new number, for every listed controller. */
  numbers: Map<number, number>;
  /** Binding lines whose controller number changed. */
  bindings: number;
  /** The listed controllers that get a new number or id. */
  updated: string[];
  /** Listed controllers not connected, whose bindings were moved off a connected one's number. */
  setAside: string[];
}

/**
 * The new content of controls.ini. Every listed controller with a connected match gets that
 * controller's DirectInput number and instance GUID; one that is not connected gets a number
 * no connected controller has, so its bindings stop acting on another controller (Content
 * Manager does the same with its placeholders). Every other line is kept as it is.
 */
export function rewriteControls(
  text: string,
  live: InputDevice[],
  choices: AcChoice[]
): Result<AcRewrite> {
  const ini = parseIni(text);
  const listed = listedControllers(ini);
  if (listed.length === 0) {
    return err(
      'racing.repair',
      'controls.ini lists no controllers, so there is nothing to update.'
    );
  }
  if (!orderKnown(live)) {
    return err(
      'racing.repair',
      'RigReady cannot see the order in which Windows lists the controllers, so it cannot renumber them.'
    );
  }
  const matches = matchControllers(listed, live);
  const counts = bindingCounts(ini);
  const chosen = new Map<number, InputDevice>();
  for (const choice of choices) {
    const m = matches.find((x) => x.listed.index === choice.index);
    if (!m) return err('racing.repair', `controls.ini has no controller ${choice.index}.`);
    if (m.target) {
      if (cleanGuid(m.target.guid) === cleanGuid(choice.guid)) continue;
      return err(
        'racing.repair',
        `${m.listed.name} (controller ${choice.index}) is already matched to a connected controller.`
      );
    }
    const device = m.candidates.find((d) => cleanGuid(d.guid) === cleanGuid(choice.guid));
    if (!device) {
      return err('racing.repair', `The chosen controller is not a connected ${m.listed.name}.`);
    }
    chosen.set(choice.index, device);
  }
  const targetOf = (m: AcMatch): InputDevice | undefined => m.target ?? chosen.get(m.listed.index);
  const taken = new Map<string, AcMatch>();
  for (const m of matches) {
    const t = targetOf(m);
    if (!t) {
      if (m.candidates.length > 0 && (counts.get(m.listed.index) ?? 0) > 0) {
        return err(
          'racing.repair',
          `More than one connected controller could be ${m.listed.name} (controller ${m.listed.index}). Choose which one it is; RigReady does not guess.`
        );
      }
      continue;
    }
    const other = taken.get(cleanGuid(t.guid));
    if (other) {
      return err(
        'racing.repair',
        `Controllers ${other.listed.index} and ${m.listed.index} cannot both be the same ${t.name.trim()}. Choose a different controller for one of them.`
      );
    }
    taken.set(cleanGuid(t.guid), m);
  }

  // New numbers: a connected controller's own; for the rest, a number no connected one has.
  const numbers = new Map<number, number>();
  const used = new Set<number>();
  for (const m of matches) {
    const t = targetOf(m);
    if (t) {
      numbers.set(m.listed.index, t.enumerationIndex!);
      used.add(t.enumerationIndex!);
    }
  }
  const floor = Math.max(live.length, ...live.map((d) => d.enumerationIndex! + 1));
  let next = floor;
  const setAside: string[] = [];
  for (const m of matches) {
    if (numbers.has(m.listed.index)) continue;
    let n = m.listed.index;
    if (n < floor || used.has(n)) {
      while (used.has(next)) next++;
      n = next;
      if ((counts.get(m.listed.index) ?? 0) > 0) setAside.push(m.listed.name);
    }
    numbers.set(m.listed.index, n);
    used.add(n);
  }

  const updated: string[] = [];
  for (const m of matches) {
    const t = targetOf(m);
    const renumbered = numbers.get(m.listed.index) !== m.listed.index;
    const newId = t !== undefined && cleanGuid(t.guid) !== m.listed.instanceGuid;
    if (renumbered || (newId && m.listed.instanceGuid)) updated.push(m.listed.name);
  }
  if (updated.length === 0) {
    return err('racing.repair', 'Every controller in controls.ini is already where it is now.');
  }

  // The new [CONTROLLERS] block, in number order.
  const block: string[] = [];
  for (const m of [...matches].sort(
    (a, b) => numbers.get(a.listed.index)! - numbers.get(b.listed.index)!
  )) {
    const n = numbers.get(m.listed.index)!;
    const t = targetOf(m);
    const guid = t ? cleanGuid(t.guid) : m.listed.instanceGuid;
    block.push(`CON${n}=${m.listed.name}`);
    if (guid) block.push(`__IGUID${n}=${guid}`);
    if (m.listed.rawProductGuid !== undefined) block.push(`PGUID${n}=${m.listed.rawProductGuid}`);
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  let section = '';
  let blockWritten = false;
  let bindings = 0;
  for (const line of text.split(/\r?\n/)) {
    const head = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (head) {
      section = head[1]!.toUpperCase();
      out.push(line);
      continue;
    }
    if (section === 'CONTROLLERS') {
      if (/^\s*(CON|__IGUID|PGUID)\d+\s*=/i.test(line)) {
        if (!blockWritten) out.push(...block);
        blockWritten = true;
        continue;
      }
      out.push(line);
      continue;
    }
    const device = DEVICE_KEY.exec(line);
    if (device && section !== 'X360') {
      const old = Number(device[4]);
      const now = numbers.get(old);
      if (old >= 0 && now !== undefined && now !== old) {
        out.push(`${device[1]}${device[2]}${device[3]}${now}${device[5]}`);
        bindings++;
        continue;
      }
    }
    out.push(line);
  }
  return ok({ text: out.join(eol), numbers, bindings, updated, setAside });
}

interface AcRepairPlan {
  file: string;
  rewrite: AcRewrite;
}

async function planRepair(ctx: RacingContext, choices: AcChoice[]): Promise<Result<AcRepairPlan>> {
  const cfg = await locationOf(ctx, 'assetto-corsa', 'cfg');
  if (!cfg) return err('racing.repair', 'The Assetto Corsa cfg folder in Documents was not found.');
  const file = path.join(cfg, 'controls.ini');
  if (!(await ctx.ports.files.exists(file))) {
    return err('racing.repair', 'Assetto Corsa has no controls.ini yet.');
  }
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return text;
  const live = await liveControllers(ctx);
  if (!live) return err('racing.repair', 'The connected controllers cannot be read right now.');
  const rewrite = rewriteControls(text.value, live, choices);
  if (!rewrite.ok) return rewrite;
  return ok({ file, rewrite: rewrite.value });
}

/** What the repair would change in controls.ini. Nothing is written. */
export async function previewRepairAc(
  ctx: RacingContext,
  choices: AcChoice[]
): Promise<Result<ChangePreview>> {
  const plan = await planRepair(ctx, choices);
  if (!plan.ok) return plan;
  return changePreview(ctx.ports.files, [
    { path: plan.value.file, content: plan.value.rewrite.text },
  ]);
}

/**
 * Renumbers the controllers in controls.ini to the order Windows lists them now, and puts in
 * a moved controller's new instance GUID. Refused while the game or Content Manager runs. One
 * journaled change, backed up first and read back after.
 */
export async function repairAc(
  ctx: RacingContext,
  choices: AcChoice[]
): Promise<Result<{ message: string; files: string[] }>> {
  const blocked = await refuseWhileRunning(ctx, 'assetto-corsa');
  if (!blocked.ok) return blocked;
  const plan = await planRepair(ctx, choices);
  if (!plan.ok) return plan;
  const { file, rewrite } = plan.value;
  const group = ctx.ports.files.beginGroup(
    `Point Assetto Corsa's controls at ${rewrite.updated.join(', ')} where Windows lists them now`
  );
  const written = await ctx.ports.files.write(file, rewrite.text, {
    reason: 'Update the controller numbers in controls.ini',
    group,
  });
  if (!written.ok) return written;
  // Read back: only report what is really on disk.
  const back = await ctx.ports.files.readText(file);
  if (!back.ok) return back;
  if (back.value !== rewrite.text) {
    return err('racing.repair', 'controls.ini did not keep the change.');
  }
  const what =
    rewrite.bindings === 0
      ? `Updated the Windows id of ${rewrite.updated.join(', ')} in controls.ini.`
      : `Updated ${rewrite.bindings === 1 ? '1 binding' : `${rewrite.bindings} bindings`} of ${rewrite.updated.join(', ')} in controls.ini.`;
  const aside =
    rewrite.setAside.length > 0
      ? ` The bindings of ${rewrite.setAside.join(', ')} (not connected) no longer act on another controller.`
      : '';
  return ok({
    message: `${what}${aside} Undo is on the Safety page.`,
    files: [file],
  });
}
