import { guidFromBytes } from '../../../core/directInput';
import { err, ok, type Result } from '../../../core/result';

/**
 * iRacing's bindings file, Documents\iRacing\controls.cfg, and the copy a car with
 * "custom controls" has in setups\<car>\controls.cfg. The layout is in
 * docs/research/iracing-bindings.md: a "GFCC" header with a block of settings, then one
 * "LRTC" chunk of records, each an action name, a NUL and 68 bytes, then two bytes.
 *
 * Every byte of the file is kept (head, the 68 bytes of each record, tail), so a file
 * that was read can be put together again unchanged, and each record says whether
 * RigReady understands all of its bytes (`understood`). RigReady reads this file; it
 * does not write bindings into it (see the research for why).
 */

/** Bytes after the name of each record. */
export const RECORD_BYTES = 68;

const MAGIC = 'GFCC';
const CHUNK = 'LRTC';
/** No action name in iRacing comes near this; a longer run of bytes is not a name. */
const MAX_NAME = 64;

export type InputKind = 'axis' | 'button' | 'key';

/** The value of the type field for each kind; it is also the kind's bit in the mask. */
const TYPE: Record<InputKind, number> = { axis: 1, button: 2, key: 4 };

export type Binding =
  | { kind: 'none' }
  | {
      kind: 'axis';
      /** iRacing's own number for the axis on that device (joyCalib.yaml names it). */
      axis: number;
      /** Upper case, without braces. */
      instanceGuid: string;
      productGuid: string;
      /** 1 on the second half of a split axis (SteerRight), 0 everywhere else seen. */
      direction: number;
    }
  | {
      kind: 'button';
      /** Zero-based button numbers, one per bit set. Every file seen has exactly one. */
      buttons: number[];
      instanceGuid: string;
      productGuid: string;
    }
  | {
      kind: 'key';
      /** iRacing's own key code (not always the Windows one). */
      keyCode: number;
      /** Two bits each: Shift 0x03, Ctrl 0x0C, Alt 0x30. */
      modifiers: number;
    }
  /** A kind of input this code has never seen in a file (a type other than 0, 1, 2 or 4). */
  | { kind: 'unknown'; type: number };

export interface ControlRecord {
  /** iRacing's id of the action: "Throttle", "BrakeBiasInc". */
  action: string;
  /** Where the 68 bytes start in the file. */
  offset: number;
  /** The 68 bytes exactly as they are in the file. */
  data: Uint8Array;
  /** First field, 0 or 1. What it means is not known; it is kept as it is. */
  flag: number;
  /** Second field: one bit per kind of input the action accepts. */
  mask: number;
  /** The kinds RigReady knows from the mask. */
  accepts: InputKind[];
  binding: Binding;
  /** True when writing the fields above back gives the same 68 bytes: nothing was left unread. */
  understood: boolean;
}

export interface ControlsFile {
  /** Everything before the first record: the GFCC header, its settings and the LRTC chunk header. */
  head: Uint8Array;
  records: ControlRecord[];
  /** What follows the last record. */
  tail: Uint8Array;
}

const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

function putU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

const hexOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const guidAt = (data: Uint8Array, at: number): string =>
  guidFromBytes(hexOf(data.subarray(at, at + 16))) ?? '';

/** The 16 bytes Windows stores for a GUID given as text (the reverse of guidFromBytes). */
export function guidBytes(guid: string): Uint8Array {
  const h = guid.replace(/[{}-]/g, '');
  const out = new Uint8Array(16);
  if (!/^[0-9a-fA-F]{32}$/.test(h)) return out;
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  order.forEach((from, i) => {
    out[i] = Number.parseInt(h.slice(from * 2, from * 2 + 2), 16);
  });
  return out;
}

function indexOfText(bytes: Uint8Array, text: string, from: number): number {
  for (let i = from; i + text.length <= bytes.length; i++) {
    let same = true;
    for (let j = 0; j < text.length; j++) {
      if (bytes[i + j] !== text.charCodeAt(j)) {
        same = false;
        break;
      }
    }
    if (same) return i;
  }
  return -1;
}

function acceptsOf(mask: number): InputKind[] {
  return (Object.keys(TYPE) as InputKind[]).filter((kind) => (mask & TYPE[kind]) !== 0);
}

function decodeBinding(data: Uint8Array): Binding {
  const type = u32(data, 8);
  if (type === 0) return { kind: 'none' };
  if (type === TYPE.axis) {
    return {
      kind: 'axis',
      axis: u32(data, 12),
      instanceGuid: guidAt(data, 20),
      productGuid: guidAt(data, 36),
      direction: u32(data, 52),
    };
  }
  if (type === TYPE.button) {
    const buttons: number[] = [];
    // 16 bytes, one bit per button: bit 0 of the first byte is the first button.
    for (let bit = 0; bit < 128; bit++) {
      if ((data[12 + (bit >> 3)]! & (1 << (bit & 7))) !== 0) buttons.push(bit);
    }
    return {
      kind: 'button',
      buttons,
      instanceGuid: guidAt(data, 36),
      productGuid: guidAt(data, 52),
    };
  }
  if (type === TYPE.key) {
    return { kind: 'key', keyCode: u32(data, 12), modifiers: data[18]! };
  }
  return { kind: 'unknown', type };
}

/**
 * The 68 bytes of a record from its fields: the layout as far as it is understood. A
 * record of the real file that does not come back byte for byte holds something this
 * code does not know, and is shown as such instead of being guessed at.
 */
export function encodeRecordData(flag: number, mask: number, binding: Binding): Uint8Array {
  const data = new Uint8Array(RECORD_BYTES);
  putU32(data, 0, flag);
  putU32(data, 4, mask);
  if (binding.kind === 'none') return data;
  if (binding.kind === 'unknown') {
    putU32(data, 8, binding.type);
    return data;
  }
  putU32(data, 8, TYPE[binding.kind]);
  if (binding.kind === 'axis') {
    putU32(data, 12, binding.axis);
    data.set(guidBytes(binding.instanceGuid), 20);
    data.set(guidBytes(binding.productGuid), 36);
    putU32(data, 52, binding.direction);
  } else if (binding.kind === 'button') {
    for (const bit of binding.buttons) {
      if (bit >= 0 && bit < 128) data[12 + (bit >> 3)]! |= 1 << (bit & 7);
    }
    data.set(guidBytes(binding.instanceGuid), 36);
    data.set(guidBytes(binding.productGuid), 52);
  } else {
    putU32(data, 12, binding.keyCode);
    data[18] = binding.modifiers & 0xff;
  }
  return data;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function damaged(detail: string): Result<never> {
  return err(
    'iracing-bindings.file',
    'This is not an iRacing bindings file RigReady can read, or it is damaged.',
    detail
  );
}

export function parseControlsFile(bytes: Uint8Array): Result<ControlsFile> {
  if (bytes.length < 12 || indexOfText(bytes.subarray(0, 4), MAGIC, 0) !== 0) {
    return damaged('The file does not start with GFCC.');
  }
  const chunk = indexOfText(bytes, CHUNK, 4);
  if (chunk < 0 || chunk + 12 > bytes.length) return damaged('The LRTC chunk was not found.');
  const start = chunk + 12;
  const end = start + u32(bytes, chunk + 8);
  if (end > bytes.length) return damaged('The LRTC chunk is longer than the file.');
  const records: ControlRecord[] = [];
  let at = start;
  while (at < end) {
    let nul = at;
    while (nul < end && bytes[nul] !== 0) nul++;
    const length = nul - at;
    if (length === 0 || length > MAX_NAME || nul + 1 + RECORD_BYTES > end) {
      return damaged(`Record ${records.length + 1} at byte ${at} is not a name and 68 bytes.`);
    }
    let action = '';
    for (let i = at; i < nul; i++) {
      const code = bytes[i]!;
      // Names are plain letters and digits; anything else means the walk has lost its place.
      if (code < 0x20 || code > 0x7e) return damaged(`Record ${records.length + 1} has no name.`);
      action += String.fromCharCode(code);
    }
    const offset = nul + 1;
    const data = bytes.slice(offset, offset + RECORD_BYTES);
    const flag = u32(data, 0);
    const mask = u32(data, 4);
    const binding = decodeBinding(data);
    records.push({
      action,
      offset,
      data,
      flag,
      mask,
      accepts: acceptsOf(mask),
      binding,
      understood:
        binding.kind !== 'unknown' && sameBytes(encodeRecordData(flag, mask, binding), data),
    });
    at = offset + RECORD_BYTES;
  }
  if (records.length === 0) return damaged('The LRTC chunk holds no records.');
  return ok({ head: bytes.slice(0, start), records, tail: bytes.slice(end) });
}

/** The file again, byte for byte, from what parseControlsFile kept. */
export function encodeControlsFile(file: ControlsFile): Uint8Array {
  const size =
    file.head.length +
    file.records.reduce((sum, r) => sum + r.action.length + 1 + r.data.length, 0) +
    file.tail.length;
  const out = new Uint8Array(size);
  out.set(file.head, 0);
  let at = file.head.length;
  for (const record of file.records) {
    for (let i = 0; i < record.action.length; i++) out[at + i] = record.action.charCodeAt(i);
    at += record.action.length + 1;
    out.set(record.data, at);
    at += record.data.length;
  }
  out.set(file.tail, at);
  return out;
}

/** VID and PID of a HID device from its DirectInput product GUID (PPPPVVVV-0000-0000-0000-504944564944). */
export function usbIdsOf(productGuid: string): { vendorId: string; productId: string } | undefined {
  const match = /^([0-9A-F]{4})([0-9A-F]{4})-0000-0000-0000-504944564944$/.exec(
    productGuid.replace(/[{}]/g, '').toUpperCase()
  );
  return match ? { productId: match[1]!, vendorId: match[2]! } : undefined;
}
