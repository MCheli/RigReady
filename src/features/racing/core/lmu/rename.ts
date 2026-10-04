import { isDeepStrictEqual } from 'node:util';
import type { InputDevice } from '../../../../shared/models';
import { cleanGuid } from '../context';
import { vidPidFromProductGuid } from '../devices';

/**
 * A controller Windows now calls something else (a driver or firmware update renamed it).
 * Le Mans Ultimate keys a controller by "<product name>:<instance name>-<16 hex>" and every
 * binding names that key, so the bindings stop reaching the controller. The product guid
 * (vendor and product id) stays, which is how the controller is recognised here.
 *
 * Two repairs, both pure text changes to direct input.json (docs/research/racing.md 3.3):
 *  - the game already lists the controller under its new name (it ran since): the bindings
 *    are pointed at that entry, whose key the game wrote itself;
 *  - it does not: the name is replaced in the key, in "product name" and "instance name" and
 *    in every binding. The hex suffix is kept as it is; what it is made from is not known.
 * Anything else (several different names for one model, a key that is not built from the
 * product name) is left alone: no plan, so no repair is offered.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const SECTIONS = ['Input', 'Alternative Input'] as const;

export interface LmuRename {
  oldKey: string;
  newKey: string;
  oldName: string;
  newName: string;
  /** The game already has an entry under the new name; only the bindings move to it. */
  existing: boolean;
  /** Bindings that name the old key. */
  bindings: number;
  /** "instance name" of the entry, when it carries the product name too. */
  instance?: { from: string; to: string };
}

export interface LmuRenamePlan {
  renames: LmuRename[];
  /** direct input.json after the repair; everything else in it byte for byte as it was. */
  text: string;
  bindings: number;
}

const swapName = (value: string, from: string, to: string): string | undefined =>
  value === from
    ? to
    : value.startsWith(`${from}:`)
      ? `${to}${value.slice(from.length)}`
      : undefined;

function findRenames(di: Json, live: InputDevice[]): LmuRename[] {
  const devices = isObject(di['Devices']) ? di['Devices'] : {};
  const references = new Map<string, number>();
  for (const section of SECTIONS) {
    for (const raw of Object.values(isObject(di[section]) ? di[section] : {})) {
      if (isObject(raw) && typeof raw['device'] === 'string') {
        references.set(raw['device'], (references.get(raw['device']) ?? 0) + 1);
      }
    }
  }
  const renames: LmuRename[] = [];
  for (const [oldKey, raw] of Object.entries(devices)) {
    if (!isObject(raw)) continue;
    const oldName = raw['product name'];
    const guid = raw['product guid'];
    if (typeof oldName !== 'string' || typeof guid !== 'string') continue;
    const ids = vidPidFromProductGuid(cleanGuid(guid));
    if (!ids) continue;
    const names = new Set(
      live
        .filter((d) => d.vendorId === ids.vendorId && d.productId === ids.productId)
        .map((d) => d.name.trim())
    );
    // Connected under the name the game has, not connected, or two names for one model
    // (RigReady does not guess which one this entry is).
    if (names.size !== 1 || names.has(oldName) || names.has('')) continue;
    const newName = [...names][0]!;
    const bindings = references.get(oldKey) ?? 0;
    const already = Object.entries(devices).filter(
      ([key, other]) =>
        key !== oldKey &&
        isObject(other) &&
        other['product name'] === newName &&
        typeof other['product guid'] === 'string' &&
        cleanGuid(other['product guid']) === cleanGuid(guid)
    );
    if (already.length > 0) {
      if (already.length === 1 && bindings > 0) {
        renames.push({
          oldKey,
          newKey: already[0]![0],
          oldName,
          newName,
          existing: true,
          bindings,
        });
      }
      continue;
    }
    const newKey = swapName(oldKey, oldName, newName);
    // A key that is not built from the product name is a format this repair does not know.
    if (newKey === undefined || newKey === oldKey || newKey in devices) continue;
    const instanceName = raw['instance name'];
    const instanceTo =
      typeof instanceName === 'string' ? swapName(instanceName, oldName, newName) : undefined;
    renames.push({
      oldKey,
      newKey,
      oldName,
      newName,
      existing: false,
      bindings,
      ...(typeof instanceName === 'string' && instanceTo !== undefined
        ? { instance: { from: instanceName, to: instanceTo } }
        : {}),
    });
  }
  return renames;
}

/** The repaired file as data: what the repaired text must mean, nothing more and nothing less. */
function renamedObject(di: Json, renames: LmuRename[]): Json {
  const out = structuredClone(di);
  const devices = isObject(out['Devices']) ? out['Devices'] : {};
  for (const rename of renames) {
    for (const section of SECTIONS) {
      for (const raw of Object.values(isObject(out[section]) ? out[section] : {})) {
        if (isObject(raw) && raw['device'] === rename.oldKey) raw['device'] = rename.newKey;
      }
    }
    if (rename.existing) continue;
    const device = devices[rename.oldKey] as Json;
    delete devices[rename.oldKey];
    device['product name'] = rename.newName;
    if (rename.instance) device['instance name'] = rename.instance.to;
    devices[rename.newKey] = device;
  }
  return out;
}

/** The same change made to the text, one string at a time, so nothing else moves. */
function renamedText(text: string, renames: LmuRename[]): string {
  return text.replace(/("(?:[^"\\]|\\.)*")(\s*:)?/g, (token: string, literal: string, colon) => {
    let value: unknown;
    try {
      value = JSON.parse(literal);
    } catch {
      // Not a string JSON can read: it is not one of the names, so it stays as it is.
      return token;
    }
    const isKey = colon !== undefined;
    for (const rename of renames) {
      let next: string | undefined;
      if (value === rename.oldKey) {
        // The entry itself keeps its key when the bindings move to an entry that exists.
        if (!isKey || !rename.existing) next = rename.newKey;
      } else if (!isKey && !rename.existing) {
        if (rename.instance && value === rename.instance.from) next = rename.instance.to;
        else if (value === rename.oldName) next = rename.newName;
      }
      if (next !== undefined)
        return `${JSON.stringify(next)}${(colon as string | undefined) ?? ''}`;
    }
    return token;
  });
}

/**
 * What to change so the bindings reach the renamed controllers, or undefined when there is
 * nothing to repair or the file is not laid out the way this repair understands. The plan
 * is only returned when the changed text, read back as JSON, is exactly the intended change.
 */
export function planLmuRename(
  text: string,
  di: Json,
  live: InputDevice[]
): LmuRenamePlan | undefined {
  const renames = findRenames(di, live);
  if (renames.length === 0) return undefined;
  const next = renamedText(text, renames);
  let parsed: unknown;
  try {
    parsed = JSON.parse(next);
  } catch {
    // The changed text is no longer JSON: this file is not one the repair can change safely.
    return undefined;
  }
  if (!isDeepStrictEqual(parsed, renamedObject(di, renames))) return undefined;
  return { renames, text: next, bindings: renames.reduce((n, r) => n + r.bindings, 0) };
}
