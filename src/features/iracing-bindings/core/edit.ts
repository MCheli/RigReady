import { err, ok, type Result } from '../../../core/result';
import {
  RECORD_BYTES,
  encodeControlsFile,
  encodeRecordData,
  parseControlsFile,
  type Binding,
  type ControlRecord,
} from './controlsFile';
import { iracingKeyKnown } from './names';

/**
 * Sets or clears the binding of one action in a controls.cfg, and leaves every other byte
 * of the file as it was.
 *
 * A record is a name and 68 bytes of a fixed size, so one change rewrites the 60 bytes
 * after the first two fields of one record (bytes +8 to +67) and nothing else: not the
 * header, not the first field (whose meaning is not known), not the mask, not another
 * record, not the two bytes at the end. The file keeps its length, so the sizes in the
 * header stay right.
 *
 * It composes only what was seen in a real file: one button of a controller, or one key
 * with Shift, Ctrl and Alt. Axes are left to iRacing (it calibrates an axis as it binds
 * it, and numbers axes its own way), and a hat switch has never been seen in a file.
 *
 * Nothing here touches a disk: bytes in, bytes out. Whether iRacing accepts the result is
 * what the rig proof in docs/research/iracing-bindings.md is for.
 */

/** Where the bytes this code may change start in a record: after the flag and the mask. */
export const KEPT_BYTES = 8;

/** What an action can be changed to. `null` clears the binding. */
export type NewBinding =
  | {
      kind: 'button';
      /** DirectInput instance GUID of the controller. */
      instanceGuid: string;
      productGuid: string;
      /** Zero-based, as the file counts: the first button is 0. */
      button: number;
    }
  | {
      kind: 'key';
      /** iRacing's own key code; it must be in iRacing's table. */
      keyCode: number;
      /** Two bits each: Shift 0x03, Ctrl 0x0C, Alt 0x30. */
      modifiers: number;
    }
  | null;

export interface Change {
  /** The whole file after the change: the same length as before. */
  bytes: Uint8Array;
  /** The record as it was. */
  before: ControlRecord;
  /** The record as it is in `bytes`. */
  after: ControlRecord;
  /** True when the action already had exactly this binding: `bytes` equals the input. */
  same: boolean;
  /** The only bytes that may differ from the input: `from` up to, not including, `to`. */
  from: number;
  to: number;
}

const MODIFIER_PAIRS = [0x03, 0x0c, 0x30];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function refuse(code: string, message: string, detail?: string): Result<never> {
  return err(`iracing-bindings.edit.${code}`, message, detail);
}

function bindingFor(record: ControlRecord, to: NewBinding): Result<Binding> {
  if (to === null) return ok({ kind: 'none' });
  if (!record.accepts.includes(to.kind)) {
    return refuse(
      'kind',
      to.kind === 'button'
        ? 'iRacing does not take a button for this action.'
        : 'iRacing does not take a key for this action.'
    );
  }
  if (to.kind === 'button') {
    if (!Number.isInteger(to.button) || to.button < 0 || to.button > 127) {
      return refuse('button', 'iRacing bindings hold buttons 1 to 128 of a controller.');
    }
    if (!GUID.test(to.instanceGuid) || !GUID.test(to.productGuid)) {
      return refuse('device', 'That controller has no id RigReady can write for iRacing.');
    }
    return ok({
      kind: 'button',
      buttons: [to.button],
      instanceGuid: to.instanceGuid.toUpperCase(),
      productGuid: to.productGuid.toUpperCase(),
    });
  }
  if (!iracingKeyKnown(to.keyCode)) {
    return refuse('key', 'That key is not in iRacing’s list of keys. Bind it in iRacing.');
  }
  const m = to.modifiers;
  const whole =
    Number.isInteger(m) &&
    (m & ~0x3f) === 0 &&
    MODIFIER_PAIRS.every((pair) => (m & pair) === 0 || (m & pair) === pair);
  if (!whole) return refuse('modifiers', 'Only Shift, Ctrl and Alt can go with a key.');
  return ok({ kind: 'key', keyCode: to.keyCode, modifiers: m });
}

const sameBinding = (a: Binding, b: Binding): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The file with one action bound to `to`, or cleared. Refuses, with the reason, anything
 * it cannot do without guessing, and checks its own result before handing it over: the
 * same length, no byte changed outside the 60 bytes of that one record, and a file that
 * reads back as the same actions with exactly the binding asked for.
 */
export function changeBinding(
  bytes: Uint8Array,
  action: string,
  wanted: NewBinding
): Result<Change> {
  const parsed = parseControlsFile(bytes);
  if (!parsed.ok) return parsed;
  // A file RigReady cannot put together again byte for byte is one it does not know well
  // enough to change.
  if (!sameBytes(encodeControlsFile(parsed.value), bytes)) {
    return refuse(
      'roundTrip',
      'RigReady does not read this file exactly, so it will not change it. Change the binding in iRacing.'
    );
  }
  const found = parsed.value.records.filter((r) => r.action === action);
  if (found.length === 0) {
    return refuse('noAction', 'iRacing has no such action in this set.', action);
  }
  if (found.length > 1) {
    return refuse(
      'twice',
      'This action is in the file more than once, so RigReady will not change it.',
      action
    );
  }
  const before = found[0]!;
  if (!before.understood || before.binding.kind === 'unknown') {
    return refuse(
      'notUnderstood',
      'This action holds a binding RigReady cannot read, so it will not change it. Change it in iRacing.'
    );
  }
  if (before.binding.kind === 'axis') {
    return refuse(
      'axis',
      'This action is on an axis. Change an axis in iRacing: it calibrates the axis as it binds it.'
    );
  }
  const binding = bindingFor(before, wanted);
  if (!binding.ok) return binding;

  const data = encodeRecordData(before.flag, before.mask, binding.value);
  // The first two fields are not this code's to change; the encoder must hand them back as they were.
  if (!sameBytes(data.subarray(0, KEPT_BYTES), before.data.subarray(0, KEPT_BYTES))) {
    return refuse(
      'kept',
      'RigReady would have changed more than the binding. Nothing was changed.'
    );
  }
  const from = before.offset + KEPT_BYTES;
  const to = before.offset + RECORD_BYTES;
  const out = bytes.slice();
  out.set(data.subarray(KEPT_BYTES), from);

  // The result is checked as a stranger's file would be, not trusted because it was just made.
  if (out.length !== bytes.length) {
    return refuse('length', 'The file would have changed its length. Nothing was changed.');
  }
  for (let i = 0; i < out.length; i++) {
    if ((i < from || i >= to) && out[i] !== bytes[i]) {
      return refuse(
        'outside',
        'RigReady would have changed more than the binding. Nothing was changed.'
      );
    }
  }
  const again = parseControlsFile(out);
  if (!again.ok || again.value.records.length !== parsed.value.records.length) {
    return refuse('reread', 'The changed file did not read back. Nothing was changed.');
  }
  let after: ControlRecord | undefined;
  for (let i = 0; i < again.value.records.length; i++) {
    const now = again.value.records[i]!;
    const was = parsed.value.records[i]!;
    if (now.action !== was.action || now.offset !== was.offset) {
      return refuse('reread', 'The changed file did not read back. Nothing was changed.');
    }
    if (was === before) after = now;
    else if (!sameBytes(now.data, was.data)) {
      return refuse(
        'outside',
        'RigReady would have changed more than the binding. Nothing was changed.'
      );
    }
  }
  if (!after || !after.understood || !sameBinding(after.binding, binding.value)) {
    return refuse('reread', 'The changed file did not read back. Nothing was changed.');
  }
  return ok({ bytes: out, before, after, same: sameBytes(out, bytes), from, to });
}
