import { createHash } from 'node:crypto';

/**
 * Removes the Windows user name from paths inside text, and nothing else.
 * "C:\Users\Owner\Saved Games" -> "C:\Users\User\Saved Games" (also / and \\ forms).
 */
export function sanitizeUserPaths(text: string, userName: string, replacement = 'User'): string {
  if (!userName) return text;
  const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `((?:\\\\\\\\|\\\\|/)Users(?:\\\\\\\\|\\\\|/))${escaped}(?=\\\\|/|"|'|$|\\s)`,
    'gi'
  );
  return text.replace(pattern, `$1${replacement}`);
}

/** Applies sanitizeUserPaths to every string inside a JSON-like value. */
export function sanitizeDeep<T>(value: T, userName: string): T {
  if (typeof value === 'string') return sanitizeUserPaths(value, userName) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, userName)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v, userName)])
    ) as T;
  }
  return value;
}

/** The SteamID64 that stands for "no account" (account number 0). */
export const NEUTRAL_STEAM_ID = '76561197960265728';

/**
 * Removes account identifiers from recorded text: any SteamID64, and the player name
 * and nickname that Le Mans Ultimate stores in its settings.
 */
export function sanitizeIdentifiers(text: string): string {
  return text
    .replace(/\b7656119\d{10}\b/g, NEUTRAL_STEAM_ID)
    .replace(/("Player (?:Name|Nick)"\s*:\s*")[^"]*(")/g, '$1Player$2');
}

/**
 * What a recording holds that names one unit of hardware: the serial numbers of devices and
 * monitors, and the instance GUIDs Windows gave game controllers (DirectInput, also in the
 * registry's calibration slots) and audio endpoints. The shapes are those of the recorded
 * JSON files; only the fields read here matter.
 */
export interface RecordedIdentity {
  devices: readonly { serial?: string }[];
  displays: readonly { serial?: string; usbSerial?: string }[];
  input: readonly { guid: string }[];
  audio: { devices: readonly { id: string }[] };
  registry: Record<string, Record<string, { type: string; value: unknown }>>;
}

/** A serial number that names no unit: shorter than four characters, or one character repeated. */
export function isPlaceholderSerial(serial: string): boolean {
  return serial.length < 4 || /^(.)\1*$/s.test(serial);
}

const DIGITS = '0123456789';
const HEX_LETTERS = 'ABCDEF';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A stream of bytes that depends only on `seed`: the same seed always gives the same bytes. */
function byteStream(seed: string): () => number {
  let block = 0;
  let bytes = Buffer.alloc(0);
  let at = 0;
  return () => {
    if (at >= bytes.length) {
      bytes = createHash('sha256').update(`rigready-fixture\0${seed}\0${block++}`).digest();
      at = 0;
    }
    return bytes[at++]!;
  };
}

/**
 * Replaces the characters at `positions` with made-up ones of the same kind: a digit for a
 * digit, a letter for a letter (taken from `letters`), in the same case. Other characters stay.
 */
function madeUp(value: string, positions: number[], letters: string, seed: string): string {
  const next = byteStream(seed);
  const out = [...value];
  for (const i of positions) {
    const c = value[i]!;
    if (c >= '0' && c <= '9') out[i] = DIGITS[next() % DIGITS.length]!;
    else if (/[a-z]/i.test(c)) {
      const letter = letters[next() % letters.length]!;
      out[i] = c === c.toLowerCase() ? letter.toLowerCase() : letter;
    }
  }
  return out.join('');
}

/**
 * A stable made-up serial number of the same shape: same length, digits where the real one
 * has digits, letters where it has letters (only A to F when the whole serial is hex), the
 * same case, every other character as it was. The same serial always gives the same result.
 */
export function madeUpSerial(serial: string): string {
  const letters = /^[0-9a-f]+$/i.test(serial) ? HEX_LETTERS : LETTERS;
  const positions = [...serial].map((_, i) => i);
  for (let attempt = 0; ; attempt++) {
    const seed = `serial\0${serial.toUpperCase()}\0${attempt}`;
    const result = madeUp(serial, positions, letters, seed);
    if (result.toUpperCase() !== serial.toUpperCase()) return result;
  }
}

/** DirectInput's instance GUIDs all end in the same node: the bytes of "DEST". */
const DIRECTINPUT_NODE = '444553540000';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Character positions of a GUID's time (time low, time mid, time high after the version digit). */
const TIME_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 15, 16, 17];
/** Character positions of the clock sequence (after the variant digit) and the node. */
const TAIL_POSITIONS = [20, 21, 22, ...Array.from({ length: 12 }, (_, i) => 24 + i)];

/**
 * A stable made-up GUID of the same shape. What tells one unit from another changes: the
 * time (or the random part) and any node that is not DirectInput's. What tells nothing stays:
 * the version digit, the variant digit, and in a DirectInput GUID its slot counter and its
 * fixed node, so a controller's slots still read as slots. A DirectInput GUID is made up from
 * its time alone: controllers Windows saw at the same moment share their made-up time too.
 */
export function madeUpGuid(guid: string): string {
  if (!GUID.test(guid)) throw new Error(`Not a GUID: ${guid.length} characters`);
  const upper = guid.toUpperCase();
  const directInput = upper[14] === '1' && upper.endsWith(DIRECTINPUT_NODE);
  const positions = directInput ? TIME_POSITIONS : [...TIME_POSITIONS, ...TAIL_POSITIONS];
  const seed = directInput ? upper.slice(0, 18) : upper;
  for (let attempt = 0; ; attempt++) {
    const result = madeUp(guid, positions, HEX_LETTERS, `guid\0${seed}\0${attempt}`);
    if (result.toUpperCase() !== upper) return result;
  }
}

const swapBytes = (part: string): string => part.match(/../g)!.reverse().join('');

/** A GUID's 16 bytes as Windows keeps them in the registry: hex, the first three groups byte-swapped. */
export function guidRegistryBytes(guid: string): string {
  const h = guid.replace(/-/g, '');
  return (
    swapBytes(h.slice(0, 8)) + swapBytes(h.slice(8, 12)) + swapBytes(h.slice(12, 16)) + h.slice(16)
  );
}

function guidFromRegistryBytes(hex: string): string | undefined {
  if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined;
  const h = hex.toUpperCase();
  return [
    swapBytes(h.slice(0, 8)),
    swapBytes(h.slice(8, 12)),
    swapBytes(h.slice(12, 16)),
    h.slice(16, 20),
    h.slice(20),
  ].join('-');
}

/**
 * Every serial number and instance GUID in a recording, each with its made-up stand-in.
 * Serials that name no unit (`isPlaceholderSerial`) are left as they are.
 */
export function identityReplacements(recording: RecordedIdentity): Map<string, string> {
  const map = new Map<string, string>();
  const serial = (value: string | undefined): void => {
    if (value && !isPlaceholderSerial(value)) map.set(value, madeUpSerial(value));
  };
  const guid = (value: string | undefined): void => {
    if (value && GUID.test(value)) map.set(value.toUpperCase(), madeUpGuid(value.toUpperCase()));
  };
  for (const device of recording.devices) serial(device.serial);
  for (const display of recording.displays) {
    serial(display.serial);
    serial(display.usbSerial);
  }
  for (const controller of recording.input) guid(controller.guid);
  for (const [key, values] of Object.entries(recording.registry)) {
    const raw = values['GUID'];
    if (
      /\\Calibration\\\d+$/i.test(key) &&
      raw?.type === 'binary' &&
      typeof raw.value === 'string'
    ) {
      guid(guidFromRegistryBytes(raw.value));
    }
  }
  for (const endpoint of recording.audio.devices) {
    guid(/\{([0-9a-f-]{36})\}$/i.exec(endpoint.id)?.[1]);
  }
  return map;
}

/** `target` in the letter case of `source`, position by position. */
function inCaseOf(source: string, target: string): string {
  return [...target]
    .map((c, i) => {
      const s = source[i] ?? '';
      if (s >= 'a' && s <= 'z') return c.toLowerCase();
      if (s >= 'A' && s <= 'Z') return c.toUpperCase();
      return c;
    })
    .join('');
}

/**
 * Replaces every serial and GUID of `replacements` in a text, in any letter case; a GUID also
 * without its dashes and in the registry's byte order. Each keeps the case it was written in
 * (DCS writes the third group of a GUID in lower case). Only whole values are replaced, never
 * part of a longer run of letters and digits.
 */
export function replaceIdentity(text: string, replacements: ReadonlyMap<string, string>): string {
  if (replacements.size === 0) return text;
  const spellings = new Map<string, string>();
  for (const [from, to] of replacements) {
    spellings.set(from.toLowerCase(), to);
    if (GUID.test(from)) {
      spellings.set(from.replace(/-/g, '').toLowerCase(), to.replace(/-/g, ''));
      spellings.set(guidRegistryBytes(from).toLowerCase(), guidRegistryBytes(to));
    }
  }
  const alternatives = [...spellings.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![0-9a-z])(?:${alternatives.join('|')})(?![0-9a-z])`, 'gi');
  return text.replace(pattern, (found) => inCaseOf(found, spellings.get(found.toLowerCase())!));
}

/**
 * Replaces the 16 raw bytes of every GUID of `replacements`, in the order Windows keeps them
 * (iRacing's controls.cfg holds each controller's instance GUID that way), with those of its
 * made-up stand-in. Everything else in the data stays as it is.
 */
export function replaceIdentityBytes(
  data: Buffer,
  replacements: ReadonlyMap<string, string>
): Buffer {
  let out = data;
  for (const [from, to] of replacements) {
    if (!GUID.test(from)) continue;
    const needle = Buffer.from(guidRegistryBytes(from), 'hex');
    const stand = Buffer.from(guidRegistryBytes(to), 'hex');
    let at = out.indexOf(needle);
    if (at === -1) continue;
    out = Buffer.from(out);
    while (at !== -1) {
      stand.copy(out, at);
      at = out.indexOf(needle, at + needle.length);
    }
  }
  return out;
}
