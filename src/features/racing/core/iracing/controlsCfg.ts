import { guidFromBytes } from '../../../../core/directInput';
import { err, ok, type Result } from '../../../../core/result';

/**
 * iRacing's binary bindings file, Documents\iRacing\controls.cfg.
 *
 *   "GFCC" header ... "LRTC" u32 8, u32 <record bytes>, then records:
 *   NUL-terminated ASCII action name + exactly 68 bytes:
 *     +0 u32 flag, +4 u32 allowed-input mask, +8 u32 type (0 none, 1 axis, 2 button, 4 key)
 *     axis:   +12 u32 iRacing axis index, +20 instance GUID, +36 product GUID, +52 u32 direction
 *     button: +12 16-byte button bitmask, +36 instance GUID, +52 product GUID
 *     key:    +12 u32 key code
 *
 * Verified on the owner's file: 367 records. See docs/research/racing.md 2.4. Only reads;
 * the one supported change is replacing a device's 16 GUID bytes in place, which keeps
 * every length and offset as it was.
 */

export const RECORD_DATA_BYTES = 68;

export type IracingBinding =
  | { kind: 'none' }
  | { kind: 'axis'; axis: number; instanceGuid: string; productGuid: string; direction: number }
  | { kind: 'button'; buttons: number[]; instanceGuid: string; productGuid: string }
  | { kind: 'key'; keyCode: number; modifiers: number };

export interface IracingRecord {
  action: string;
  /** Offset of the 68 data bytes in the file. */
  offset: number;
  binding: IracingBinding;
}

export interface ControlsCfg {
  records: IracingRecord[];
}

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

function hex(bytes: Uint8Array, from: number, length: number): string {
  let out = '';
  for (let i = from; i < from + length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

function findChunk(bytes: Uint8Array, tag: string): number {
  outer: for (let i = 0; i + tag.length <= bytes.length; i++) {
    for (let j = 0; j < tag.length; j++) {
      if (bytes[i + j] !== tag.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

export function parseControlsCfg(bytes: Uint8Array): Result<ControlsCfg> {
  if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'GFCC') {
    return err(
      'iracing.controls',
      'controls.cfg is not an iRacing bindings file (no GFCC header).'
    );
  }
  const chunk = findChunk(bytes, 'LRTC');
  if (chunk < 0 || chunk + 12 > bytes.length) {
    return err('iracing.controls', 'controls.cfg has no bindings section (LRTC).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(chunk + 8, true);
  const start = chunk + 12;
  const end = Math.min(bytes.length, start + length);
  const records: IracingRecord[] = [];
  let at = start;
  while (at < end) {
    let nul = at;
    while (nul < end && bytes[nul] !== 0) nul++;
    if (nul === at) break; // padding at the end of the section
    if (nul + 1 + RECORD_DATA_BYTES > bytes.length) {
      return err(
        'iracing.controls',
        `controls.cfg ends inside the record for ${ascii(bytes, at, nul)}.`
      );
    }
    const action = ascii(bytes, at, nul);
    if (!/^[A-Za-z0-9_]+$/.test(action)) {
      return err('iracing.controls', `controls.cfg has an unreadable record at byte ${at}.`);
    }
    const offset = nul + 1;
    records.push({ action, offset, binding: decode(bytes, view, offset) });
    at = offset + RECORD_DATA_BYTES;
  }
  return ok({ records });
}

function decode(bytes: Uint8Array, view: DataView, offset: number): IracingBinding {
  const type = view.getUint32(offset + 8, true);
  const guid = (from: number): string => guidFromBytes(hex(bytes, offset + from, 16)) ?? '';
  if (type === 1) {
    return {
      kind: 'axis',
      axis: view.getUint32(offset + 12, true),
      instanceGuid: guid(20),
      productGuid: guid(36),
      direction: view.getUint32(offset + 52, true),
    };
  }
  if (type === 2) {
    const buttons: number[] = [];
    for (let byte = 0; byte < 16; byte++) {
      const value = bytes[offset + 12 + byte]!;
      for (let bit = 0; bit < 8; bit++) if (value & (1 << bit)) buttons.push(byte * 8 + bit);
    }
    return { kind: 'button', buttons, instanceGuid: guid(36), productGuid: guid(52) };
  }
  if (type === 4) {
    return {
      kind: 'key',
      keyCode: view.getUint32(offset + 12, true),
      modifiers: bytes[offset + 18]!,
    };
  }
  return { kind: 'none' };
}

/** The 16 bytes Windows and iRacing store for "20B0BED0-03A4-11F1-8001-444553540000". */
export function guidToBytes(guid: string): Uint8Array {
  const clean = guid.replace(/[{}-]/g, '');
  if (!/^[0-9A-Fa-f]{32}$/.test(clean)) throw new Error(`Not a GUID: ${guid}`);
  const pairs = clean.match(/../g)!.map((p) => Number.parseInt(p, 16));
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  return Uint8Array.from(order.map((i) => pairs[i]!));
}

/**
 * Replaces every occurrence of one device GUID with another, byte for byte. The file
 * keeps its length; nothing else changes. Returns how many places were changed.
 */
export function replaceGuidBytes(
  bytes: Uint8Array,
  from: string,
  to: string
): { bytes: Uint8Array; count: number } {
  const needle = guidToBytes(from);
  const replacement = guidToBytes(to);
  const out = Uint8Array.from(bytes);
  let count = 0;
  for (let i = 0; i + 16 <= out.length; i++) {
    let same = true;
    for (let j = 0; j < 16 && same; j++) same = out[i + j] === needle[j];
    if (!same) continue;
    out.set(replacement, i);
    count++;
    i += 15;
  }
  return { bytes: out, count };
}

/** Every (instance GUID, product GUID) a bound record refers to, with the actions per pair. */
export function devicesInControls(
  cfg: ControlsCfg
): { instanceGuid: string; productGuid: string; actions: string[] }[] {
  const byGuid = new Map<
    string,
    { instanceGuid: string; productGuid: string; actions: string[] }
  >();
  for (const record of cfg.records) {
    const b = record.binding;
    if (b.kind !== 'axis' && b.kind !== 'button') continue;
    const key = b.instanceGuid.toUpperCase();
    const entry = byGuid.get(key) ?? {
      instanceGuid: b.instanceGuid.toUpperCase(),
      productGuid: b.productGuid.toUpperCase(),
      actions: [],
    };
    entry.actions.push(record.action);
    byGuid.set(key, entry);
  }
  return [...byGuid.values()];
}
