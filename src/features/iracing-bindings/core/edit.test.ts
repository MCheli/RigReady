import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import {
  RECORD_BYTES,
  encodeRecordData,
  parseControlsFile,
  type Binding,
  type ControlRecord,
  type ControlsFile,
} from './controlsFile';
import { KEPT_BYTES, changeBinding, type Change, type NewBinding } from './edit';

/** The bindings file recorded from the owner's rig: byte for byte the file iRacing wrote. */
const recorded = path.join(
  fixturesDir,
  'rigs',
  'mark-full',
  'files',
  'Documents',
  'iRacing',
  'controls.cfg'
);
const BOX = '5EED0001-7A11-11EF-8004-444553540000';
const BOX_PRODUCT = '00011234-0000-0000-0000-504944564944';

const read = async (): Promise<Uint8Array> => new Uint8Array(await fs.readFile(recorded));

function fileOf(bytes: Uint8Array): ControlsFile {
  const parsed = parseControlsFile(bytes);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}
const recordOf = (bytes: Uint8Array, action: string): ControlRecord =>
  fileOf(bytes).records.find((r) => r.action === action)!;

function changed(bytes: Uint8Array, action: string, to: NewBinding): Change {
  const result = changeBinding(bytes, action, to);
  if (!result.ok) throw new Error(`${action}: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const refusal = (bytes: Uint8Array, action: string, to: NewBinding): string => {
  const result = changeBinding(bytes, action, to);
  return result.ok ? 'ok' : result.error.code;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const equal = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

/** Where two files of the same length differ. */
function differing(a: Uint8Array, b: Uint8Array): number[] {
  expect(b.length).toBe(a.length);
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  return at;
}

/** Every byte that differs lies in the 60 bytes of the one record the change names. */
function expectOnlyThatRecord(before: Uint8Array, change: Change, action: string): void {
  const record = recordOf(before, action);
  expect(change.from).toBe(record.offset + KEPT_BYTES);
  expect(change.to).toBe(record.offset + RECORD_BYTES);
  for (const at of differing(before, change.bytes)) {
    expect(at).toBeGreaterThanOrEqual(change.from);
    expect(at).toBeLessThan(change.to);
  }
}

/** What a record holds now, as the change that would put the same thing there again. */
function asWanted(binding: Binding): NewBinding | undefined {
  if (binding.kind === 'none') return null;
  if (binding.kind === 'key') return binding;
  if (binding.kind === 'button' && binding.buttons.length === 1) {
    return {
      kind: 'button',
      instanceGuid: binding.instanceGuid,
      productGuid: binding.productGuid,
      button: binding.buttons[0]!,
    };
  }
  return undefined;
}

describe('changing one iRacing binding: no change gives the same bytes', () => {
  it('gives back the recorded file byte for byte when an action is set to what it has, for every action', async () => {
    const bytes = await read();
    const kinds: Record<string, number> = {};
    for (const record of fileOf(bytes).records) {
      kinds[record.binding.kind] = (kinds[record.binding.kind] ?? 0) + 1;
      const same = asWanted(record.binding);
      if (same === undefined) {
        // An axis: left to iRacing, and said so.
        expect(record.binding.kind, record.action).toBe('axis');
        expect(refusal(bytes, record.action, null)).toBe('iracing-bindings.edit.axis');
        continue;
      }
      const result = changed(bytes, record.action, same);
      expect(result.same, record.action).toBe(true);
      expect(equal(result.bytes, bytes), record.action).toBe(true);
    }
    // The file has all of them: actions on an axis, on a button, on a key, and not bound.
    expect(Object.keys(kinds).sort()).toEqual(['axis', 'button', 'key', 'none']);
    expect(kinds['button']).toBeGreaterThan(3);
    expect(kinds['key']).toBeGreaterThan(50);
    expect(kinds['none']).toBeGreaterThan(50);
  });

  it('never hands back or alters the bytes it was given', async () => {
    const bytes = await read();
    const before = bytes.slice();
    const result = changed(bytes, 'Starter', null);
    expect(result.bytes).not.toBe(bytes);
    expect(equal(bytes, before)).toBe(true);
    expect(changed(bytes, 'Starter', asWanted(recordOf(bytes, 'Starter').binding)!).bytes).not.toBe(
      bytes
    );
  });
});

describe('changing one iRacing binding: one change alters only that record', () => {
  it('binds a button: only bytes +8 to +67 of that one record differ, and the file keeps its length', async () => {
    const bytes = await read();
    const before = fileOf(bytes);
    expect(recordOf(bytes, 'HeadlightFlash').binding).toEqual({ kind: 'none' });
    const result = changed(bytes, 'HeadlightFlash', {
      kind: 'button',
      instanceGuid: BOX,
      productGuid: BOX_PRODUCT,
      button: 6,
    });
    expect(result.same).toBe(false);
    expect(result.bytes.length).toBe(bytes.length);
    expect(differing(bytes, result.bytes).length).toBeGreaterThan(0);
    expectOnlyThatRecord(bytes, result, 'HeadlightFlash');

    // The header, every other record and the two bytes at the end are as they were.
    const after = fileOf(result.bytes);
    expect(equal(after.head, before.head)).toBe(true);
    expect(equal(after.tail, before.tail)).toBe(true);
    expect(after.records.map((r) => r.action)).toEqual(before.records.map((r) => r.action));
    before.records.forEach((record, i) => {
      expect(after.records[i]!.offset).toBe(record.offset);
      if (record.action !== 'HeadlightFlash') {
        expect(hex(after.records[i]!.data), record.action).toBe(hex(record.data));
      }
    });

    // The 60 bytes, spelled out: the kind, one bit for the seventh button, eight empty
    // bytes, then the two ids of the controller in the byte order Windows stores a GUID.
    expect(hex(result.bytes.subarray(result.from, result.to))).toBe(
      [
        '02000000',
        '40000000000000000000000000000000',
        '0000000000000000',
        '0100ed5e117aef118004444553540000',
        '34120100000000000000504944564944',
      ].join('')
    );
    expect(result.after.binding).toEqual({
      kind: 'button',
      buttons: [6],
      instanceGuid: BOX,
      productGuid: BOX_PRODUCT,
    });
    expect(result.after.understood).toBe(true);
    expect(result.before.binding).toEqual({ kind: 'none' });
  });

  it('writes a button exactly as iRacing wrote the same button for another action', async () => {
    const bytes = await read();
    // Gear1 is on a button in the recorded file. HeadlightFlash has the same first two
    // fields, so with the same button its 68 bytes must be Gear1's.
    const gear = recordOf(bytes, 'Gear1');
    const flash = recordOf(bytes, 'HeadlightFlash');
    expect(gear.binding.kind).toBe('button');
    expect([flash.flag, flash.mask]).toEqual([gear.flag, gear.mask]);
    const result = changed(bytes, 'HeadlightFlash', asWanted(gear.binding)!);
    expect(hex(result.after.data)).toBe(hex(gear.data));
    expectOnlyThatRecord(bytes, result, 'HeadlightFlash');
  });

  it('writes a key exactly as iRacing wrote it, with Shift, Ctrl and Alt', async () => {
    const bytes = await read();
    // First field 0: Starter is on S. First field 1: Ignition on I, the visor on Alt+T,
    // the wipers on Shift+W and on Ctrl+Alt+W. Each is put on an unbound action with the
    // same first two fields, and must give the very bytes iRacing wrote.
    const pairs: [string, string][] = [
      ['HeadlightFlash', 'Starter'],
      ['BlackBoxShowNext', 'Ignition'],
      ['BlackBoxShowNext', 'TearOffVisor'],
      ['BlackBoxShowNext', 'ToggleWindshieldWipers'],
      ['BlackBoxShowNext', 'TriggerWindshieldWipers'],
    ];
    for (const [target, model] of pairs) {
      const from = recordOf(bytes, model);
      const to = recordOf(bytes, target);
      expect(from.binding.kind, model).toBe('key');
      expect(to.binding, target).toEqual({ kind: 'none' });
      expect([to.flag, to.mask], target).toEqual([from.flag, from.mask]);
      const result = changed(bytes, target, asWanted(from.binding)!);
      expect(hex(result.after.data), `${target} as ${model}`).toBe(hex(from.data));
      expectOnlyThatRecord(bytes, result, target);
    }
    expect(recordOf(bytes, 'TearOffVisor').binding).toMatchObject({ modifiers: 0x30 });
    expect(recordOf(bytes, 'ToggleWindshieldWipers').binding).toMatchObject({ modifiers: 0x03 });
    expect(recordOf(bytes, 'TriggerWindshieldWipers').binding).toMatchObject({ modifiers: 0x3c });
  });

  it('clears a binding to exactly what iRacing has for an action that was never bound', async () => {
    const bytes = await read();
    // A key and a button, first field 0 and 1, each against an unbound action with the
    // same first two fields.
    for (const [bound, unbound] of [
      ['Starter', 'HeadlightFlash'],
      ['Ignition', 'BlackBoxShowNext'],
      ['Gear1', 'HeadlightFlash'],
    ] as const) {
      const empty = recordOf(bytes, unbound);
      expect(empty.binding).toEqual({ kind: 'none' });
      const result = changed(bytes, bound, null);
      expect(result.same).toBe(false);
      expect(hex(result.after.data), bound).toBe(hex(empty.data));
      expectOnlyThatRecord(bytes, result, bound);
    }
  });

  it('keeps the first two fields of the record, whatever the first one is', async () => {
    const bytes = await read();
    for (const action of ['HeadlightFlash', 'BlackBoxShowNext', 'Starter', 'Ignition', 'Gear1']) {
      const before = recordOf(bytes, action);
      for (const to of [null, { kind: 'key', keyCode: 72, modifiers: 0x0c }] as NewBinding[]) {
        const result = changed(bytes, action, to);
        expect(hex(result.after.data.subarray(0, KEPT_BYTES)), action).toBe(
          hex(before.data.subarray(0, KEPT_BYTES))
        );
        expect([result.after.flag, result.after.mask]).toEqual([before.flag, before.mask]);
      }
    }
    // Both values of the first field are covered.
    expect(recordOf(bytes, 'HeadlightFlash').flag).toBe(0);
    expect(recordOf(bytes, 'BlackBoxShowNext').flag).toBe(1);
  });

  it('a change, a clear and the change back give the first file again', async () => {
    const bytes = await read();
    for (const action of ['Starter', 'Gear1', 'HeadlightFlash', 'TriggerWindshieldWipers']) {
      const original = asWanted(recordOf(bytes, action).binding)!;
      const away = changed(bytes, action, { kind: 'key', keyCode: 200, modifiers: 0x33 });
      expect(away.same).toBe(false);
      const cleared = changed(away.bytes, action, null);
      const back = changed(cleared.bytes, action, original);
      expect(equal(back.bytes, bytes), action).toBe(true);
    }
  });

  it('replaces a key with a button and leaves nothing of the key behind', async () => {
    const bytes = await read();
    const before = recordOf(bytes, 'TriggerWindshieldWipers');
    expect(before.binding.kind).toBe('key');
    // Ids in lower case are stored the same way.
    const result = changed(bytes, 'TriggerWindshieldWipers', {
      kind: 'button',
      instanceGuid: BOX.toLowerCase(),
      productGuid: BOX_PRODUCT.toLowerCase(),
      button: 127,
    });
    expect(hex(result.after.data)).toBe(
      hex(
        encodeRecordData(before.flag, before.mask, {
          kind: 'button',
          buttons: [127],
          instanceGuid: BOX,
          productGuid: BOX_PRODUCT,
        })
      )
    );
    // The last of the 128 bits, and no trace of the key's modifiers.
    expect(result.after.data[12 + 15]).toBe(0x80);
    expect(result.after.data[18]).toBe(0);
    expectOnlyThatRecord(bytes, result, 'TriggerWindshieldWipers');
  });
});

describe('changing one iRacing binding: what is refused, and why', () => {
  const key: NewBinding = { kind: 'key', keyCode: 72, modifiers: 0 };
  const button = {
    kind: 'button' as const,
    instanceGuid: BOX,
    productGuid: BOX_PRODUCT,
    button: 0,
  };

  it('an action the file does not have', async () => {
    const bytes = await read();
    expect(refusal(bytes, 'NoSuchAction', key)).toBe('iracing-bindings.edit.noAction');
    expect(refusal(bytes, '', key)).toBe('iracing-bindings.edit.noAction');
    // Names are matched exactly.
    expect(refusal(bytes, 'headlightflash', key)).toBe('iracing-bindings.edit.noAction');
  });

  it('an action on an axis, and a kind the action does not take', async () => {
    const bytes = await read();
    expect(recordOf(bytes, 'Throttle').binding.kind).toBe('axis');
    expect(refusal(bytes, 'Throttle', key)).toBe('iracing-bindings.edit.axis');
    expect(refusal(bytes, 'Throttle', null)).toBe('iracing-bindings.edit.axis');
    // BrakeBiasLevel takes an axis only and is not bound.
    expect(recordOf(bytes, 'BrakeBiasLevel').accepts).toEqual(['axis']);
    expect(refusal(bytes, 'BrakeBiasLevel', key)).toBe('iracing-bindings.edit.kind');
    expect(refusal(bytes, 'BrakeBiasLevel', button)).toBe('iracing-bindings.edit.kind');
    // Clearing what is already empty asks for no kind: it is the same file.
    expect(changed(bytes, 'BrakeBiasLevel', null).same).toBe(true);
  });

  it('a button outside 1 to 128, and a controller id that is not one', async () => {
    const bytes = await read();
    for (const n of [-1, 128, 1.5, Number.NaN, 1e9]) {
      expect(refusal(bytes, 'HeadlightFlash', { ...button, button: n }), String(n)).toBe(
        'iracing-bindings.edit.button'
      );
    }
    for (const guid of ['', 'keyboard', `{${BOX}}`, 'x'.repeat(36), BOX.replace(/-/g, '')]) {
      expect(refusal(bytes, 'HeadlightFlash', { ...button, instanceGuid: guid }), guid).toBe(
        'iracing-bindings.edit.device'
      );
      expect(refusal(bytes, 'HeadlightFlash', { ...button, productGuid: guid }), guid).toBe(
        'iracing-bindings.edit.device'
      );
    }
  });

  it('a key iRacing has no name for, and modifiers that are not whole', async () => {
    const bytes = await read();
    for (const keyCode of [0, 7, 250, 255, 256, -1, 72.5]) {
      expect(
        refusal(bytes, 'HeadlightFlash', { kind: 'key', keyCode, modifiers: 0 }),
        String(keyCode)
      ).toBe('iracing-bindings.edit.key');
    }
    // One bit of a pair, a bit beyond the three pairs, a negative number, a fraction.
    for (const modifiers of [0x01, 0x02, 0x04, 0x10, 0x40, 0x100, -1, 0.5]) {
      expect(
        refusal(bytes, 'HeadlightFlash', { kind: 'key', keyCode: 72, modifiers }),
        String(modifiers)
      ).toBe('iracing-bindings.edit.modifiers');
    }
    for (const modifiers of [0, 0x03, 0x0c, 0x30, 0x0f, 0x33, 0x3c, 0x3f]) {
      const result = changed(bytes, 'HeadlightFlash', { kind: 'key', keyCode: 72, modifiers });
      expect(result.after.binding).toEqual({ kind: 'key', keyCode: 72, modifiers });
    }
  });

  it('a binding RigReady cannot read, while the rest of that file can still be changed', async () => {
    const bytes = await read();
    const handbrake = recordOf(bytes, 'Handbrake');
    // A kind of input never seen in a file.
    const strange = bytes.slice();
    strange[handbrake.offset + 8] = 8;
    expect(refusal(strange, 'Handbrake', key)).toBe('iracing-bindings.edit.notUnderstood');
    expect(refusal(strange, 'Handbrake', null)).toBe('iracing-bindings.edit.notUnderstood');
    // A key with a byte where no file ever had one.
    const starter = recordOf(bytes, 'Starter');
    const extra = bytes.slice();
    extra[starter.offset + 40] = 1;
    expect(refusal(extra, 'Starter', null)).toBe('iracing-bindings.edit.notUnderstood');

    const other = changed(strange, 'HeadlightFlash', key);
    expect(hex(recordOf(other.bytes, 'Handbrake').data)).toBe(
      hex(recordOf(strange, 'Handbrake').data)
    );
    expectOnlyThatRecord(strange, other, 'HeadlightFlash');
  });

  it('an action that is in the file twice', async () => {
    const bytes = await read();
    // "Starter" gets the name of "ShiftUp": the same length, so the file still reads.
    const starter = recordOf(bytes, 'Starter');
    const twice = bytes.slice();
    twice.set(Buffer.from('ShiftUp', 'latin1'), starter.offset - 1 - 'Starter'.length);
    expect(fileOf(twice).records.filter((r) => r.action === 'ShiftUp')).toHaveLength(2);
    expect(refusal(twice, 'ShiftUp', null)).toBe('iracing-bindings.edit.twice');
    expect(refusal(twice, 'ShiftUp', key)).toBe('iracing-bindings.edit.twice');
    // Another action of that file is changed as usual.
    expectOnlyThatRecord(twice, changed(twice, 'HeadlightFlash', key), 'HeadlightFlash');
  });

  it('a file that is not an iRacing bindings file', async () => {
    const bytes = await read();
    expect(refusal(new Uint8Array(0), 'Starter', null)).toBe('iracing-bindings.file');
    expect(refusal(new TextEncoder().encode('[Controls]\nx=1\n'), 'Starter', null)).toBe(
      'iracing-bindings.file'
    );
    expect(refusal(bytes.subarray(0, bytes.length - 40), 'Starter', null)).toBe(
      'iracing-bindings.file'
    );
  });
});

// ---------------------------------------------------------------- files made up here

/** A small seeded generator, so a file that fails can be made again from its number. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MASKS = [0x06, 0x1f, 0x19, 0x39, 0x02, 0x04];
const WHOLE_MODIFIERS = [0, 0x03, 0x0c, 0x30, 0x0f, 0x33, 0x3c, 0x3f];

interface Made {
  bytes: Uint8Array;
  actions: string[];
  /** Something each action accepts and does not have, or undefined for an axis-only action. */
  other: (action: string) => NewBinding | undefined;
}

/**
 * A controls.cfg that no iRacing wrote: a header of any length, 1 to 40 records with any
 * names, either value of the first field, several masks and any binding the mask allows,
 * and a tail of 0 to 4 bytes.
 */
function synthetic(seed: number): Made {
  const random = seeded(seed);
  const int = (n: number): number => Math.floor(random() * n);
  const pick = <T>(from: readonly T[]): T => from[int(from.length)]!;
  const guid = (): string => {
    const h = Array.from({ length: 32 }, () => '0123456789ABCDEF'[int(16)]).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const key = (): Binding => ({
    kind: 'key',
    keyCode: pick([65 + int(26), 48 + int(10), 197 + int(16)]),
    modifiers: pick(WHOLE_MODIFIERS),
  });
  const button = (): Binding => ({
    kind: 'button',
    buttons: [int(128)],
    instanceGuid: guid(),
    productGuid: guid(),
  });

  const names = new Set<string>();
  const count = 1 + int(40);
  while (names.size < count) {
    names.add(Array.from({ length: 1 + int(24) }, () => pick([...LETTERS])).join(''));
  }
  const parts: Uint8Array[] = [];
  const masks = new Map<string, number>();
  for (const name of names) {
    const mask = pick(MASKS);
    masks.set(name, mask);
    const kinds: Binding['kind'][] = ['none'];
    if (mask & 1) kinds.push('axis');
    if (mask & 2) kinds.push('button');
    if (mask & 4) kinds.push('key');
    const kind = pick(kinds);
    const binding: Binding =
      kind === 'axis'
        ? {
            kind: 'axis',
            axis: int(8),
            instanceGuid: guid(),
            productGuid: guid(),
            direction: int(2),
          }
        : kind === 'button'
          ? button()
          : kind === 'key'
            ? key()
            : { kind: 'none' };
    parts.push(Buffer.from(`${name}\0`, 'latin1'), encodeRecordData(int(2), mask, binding));
  }
  const chunk = Buffer.concat(parts);
  // Settings bytes below "A", so the header cannot hold the chunk's own name by chance.
  const settings = Uint8Array.from({ length: int(300) }, () => int(0x40));
  const lead = Uint8Array.from({ length: 4 }, () => int(256));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, chunk.length, true);
  const tail = Uint8Array.from({ length: int(5) }, () => int(256));
  const bytes = new Uint8Array(
    Buffer.concat([Buffer.from('GFCC'), settings, Buffer.from('LRTC'), lead, length, chunk, tail])
  );
  return {
    bytes,
    actions: [...names],
    other: (action) => {
      const mask = masks.get(action)!;
      if (mask & 4) return key() as NewBinding;
      if (mask & 2) {
        const b = button() as Extract<Binding, { kind: 'button' }>;
        return {
          kind: 'button',
          instanceGuid: b.instanceGuid,
          productGuid: b.productGuid,
          button: b.buttons[0]!,
        };
      }
      return undefined;
    },
  };
}

describe('changing one iRacing binding: files made up for the test', () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => 1000 + i * 7919);

  it('no change gives the same bytes, for every action of 150 made-up files', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { bytes } = synthetic(seed);
      for (const record of fileOf(bytes).records) {
        expect(record.understood, `seed ${seed} ${record.action}`).toBe(true);
        const same = asWanted(record.binding);
        if (same === undefined) {
          expect(refusal(bytes, record.action, null)).toBe('iracing-bindings.edit.axis');
          continue;
        }
        const result = changed(bytes, record.action, same);
        expect(result.same, `seed ${seed} ${record.action}`).toBe(true);
        expect(equal(result.bytes, bytes), `seed ${seed} ${record.action}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('one change alters only the 60 bytes of that record, and they are the bytes of the new binding', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { bytes, other } = synthetic(seed);
      const before = fileOf(bytes);
      for (const record of before.records) {
        if (record.binding.kind === 'axis') continue;
        for (const to of [other(record.action), null]) {
          if (to === undefined) continue;
          const result = changed(bytes, record.action, to);
          expectOnlyThatRecord(bytes, result, record.action);
          expect(equal(result.after.data.subarray(0, KEPT_BYTES), record.data.subarray(0, 8))).toBe(
            true
          );
          // Changing it back gives the first file again.
          const back = changed(result.bytes, record.action, asWanted(record.binding)!);
          expect(equal(back.bytes, bytes), `seed ${seed} ${record.action}`).toBe(true);
          checked++;
        }
      }
      const after = fileOf(bytes);
      expect(equal(after.head, before.head) && equal(after.tail, before.tail)).toBe(true);
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('never throws on a damaged file, and never changes a byte outside the record when it does answer', () => {
    let answered = 0;
    let refused = 0;
    for (const seed of SEEDS) {
      const { bytes, actions, other } = synthetic(seed);
      const random = seeded(seed ^ 0x5eed);
      const int = (n: number): number => Math.floor(random() * n);
      for (let round = 0; round < 8; round++) {
        let damaged = bytes.slice();
        // Flip up to four bytes anywhere, or cut the file short.
        if (round % 4 === 3) damaged = damaged.subarray(0, int(damaged.length));
        else for (let i = 0; i <= round % 4; i++) damaged[int(damaged.length)] = int(256);
        const action = actions[int(actions.length)]!;
        const to = round % 2 ? null : (other(action) ?? null);
        const result = changeBinding(damaged, action, to);
        if (!result.ok) {
          expect(result.error.code).toMatch(/^iracing-bindings\.(edit\.[a-zA-Z]+|file)$/);
          expect(result.error.message.length).toBeGreaterThan(10);
          refused++;
          continue;
        }
        answered++;
        expect(result.value.bytes.length).toBe(damaged.length);
        for (const at of differing(damaged, result.value.bytes)) {
          expect(at).toBeGreaterThanOrEqual(result.value.from);
          expect(at).toBeLessThan(result.value.to);
        }
        expect(result.value.to - result.value.from).toBe(RECORD_BYTES - KEPT_BYTES);
      }
    }
    // Both happen: damage that still leaves a file to change, and damage that does not.
    expect(answered).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });
});
