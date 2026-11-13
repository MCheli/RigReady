import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import {
  RECORD_BYTES,
  encodeControlsFile,
  encodeRecordData,
  guidBytes,
  parseControlsFile,
  usbIdsOf,
  type ControlsFile,
} from './controlsFile';

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
const WHEEL = '20B0BED0-03A4-11F1-8001-444553540000';
const WHEEL_PRODUCT = '00070EB7-0000-0000-0000-504944564944';

const read = async (file = recorded): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(file));

async function parsed(): Promise<{ bytes: Uint8Array; file: ControlsFile }> {
  const bytes = await read();
  const result = parseControlsFile(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return { bytes, file: result.value };
}

describe('iRacing controls.cfg, the recorded file', () => {
  it('reading the real file and writing it back gives the same bytes', async () => {
    const { bytes, file } = await parsed();
    const again = encodeControlsFile(file);
    expect(again.length).toBe(bytes.length);
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it('holds 367 actions, and the records fill the chunk exactly', async () => {
    const { bytes, file } = await parsed();
    expect(file.records).toHaveLength(367);
    expect(new Set(file.records.map((r) => r.action)).size).toBe(367);
    // The header ends where the first record starts; two bytes follow the last record.
    expect(file.head.length).toBe(file.records[0]!.offset - 'Throttle'.length - 1);
    expect(file.records.at(-1)!.offset + RECORD_BYTES).toBe(bytes.length - 2);
    expect(Array.from(file.tail)).toEqual([0x20, 0x20]);
  });

  it('every record is fully understood: its fields give back its 68 bytes', async () => {
    const { file } = await parsed();
    for (const record of file.records) {
      expect(record.understood, record.action).toBe(true);
      expect(
        Buffer.from(encodeRecordData(record.flag, record.mask, record.binding)).equals(
          Buffer.from(record.data)
        ),
        record.action
      ).toBe(true);
    }
  });

  it('reads the wheel, the pedals, the shifter buttons and the keys as they are on the rig', async () => {
    const { file } = await parsed();
    const of = (action: string) => file.records.find((r) => r.action === action)!;
    expect(of('Throttle').binding).toEqual({
      kind: 'axis',
      axis: 2,
      instanceGuid: WHEEL,
      productGuid: WHEEL_PRODUCT,
      direction: 0,
    });
    expect(of('SteerLeft').binding).toMatchObject({ kind: 'axis', axis: 3, direction: 0 });
    expect(of('SteerRight').binding).toMatchObject({ kind: 'axis', axis: 3, direction: 1 });
    expect(of('ShiftUp').binding).toEqual({
      kind: 'button',
      buttons: [4],
      instanceGuid: WHEEL,
      productGuid: WHEEL_PRODUCT,
    });
    expect(of('Reset').binding).toMatchObject({ kind: 'button', buttons: [25] });
    expect(of('Ignition').binding).toEqual({ kind: 'key', keyCode: 73, modifiers: 0 });
    // Alt+L, as iRacing's published shortcuts have it: Alt is the two bits 0x30.
    expect(of('ToggleirsdkDiskLogging').binding).toEqual({
      kind: 'key',
      keyCode: 76,
      modifiers: 0x30,
    });
    expect(of('Handbrake').binding).toEqual({ kind: 'none' });
    const kinds = new Map<string, number>();
    for (const r of file.records) kinds.set(r.binding.kind, (kinds.get(r.binding.kind) ?? 0) + 1);
    expect(Object.fromEntries(kinds)).toEqual({ axis: 5, button: 12, key: 166, none: 184 });
  });

  it('says what each action accepts from the mask', async () => {
    const { file } = await parsed();
    const of = (action: string) => file.records.find((r) => r.action === action)!;
    expect(of('Throttle').accepts).toEqual(['axis', 'button', 'key']);
    expect(of('SteerLeft').accepts).toEqual(['axis']);
    expect(of('Gear1').accepts).toEqual(['button', 'key']);
    expect(of('BrakeBiasLevel').accepts).toEqual(['axis']);
    // The first field is 1 here and 0 there; what it means is not known, so it is only kept.
    expect(of('BrakeBiasInc').flag).toBe(1);
    expect(of('Throttle').flag).toBe(0);
  });
});

describe('iRacing controls.cfg, what is not understood stays visible', () => {
  it('a kind of input never seen is kept byte for byte and marked as not understood', async () => {
    const bytes = await read();
    const first = parseControlsFile(bytes);
    if (!first.ok) throw new Error(first.error.message);
    const handbrake = first.value.records.find((r) => r.action === 'Handbrake')!;
    const changed = bytes.slice();
    changed[handbrake.offset + 8] = 8;
    changed[handbrake.offset + 30] = 0x7f;
    const result = parseControlsFile(changed);
    if (!result.ok) throw new Error(result.error.message);
    const record = result.value.records.find((r) => r.action === 'Handbrake')!;
    expect(record.binding).toEqual({ kind: 'unknown', type: 8 });
    expect(record.understood).toBe(false);
    expect(Buffer.from(encodeControlsFile(result.value)).equals(Buffer.from(changed))).toBe(true);
  });

  it('a known kind with bytes where none were ever seen is marked as not understood', async () => {
    const bytes = await read();
    const first = parseControlsFile(bytes);
    if (!first.ok) throw new Error(first.error.message);
    const shift = first.value.records.find((r) => r.action === 'ShiftUp')!;
    const changed = bytes.slice();
    // Bytes 28 to 35 of a button record are zero in every record of the real file.
    changed[shift.offset + 30] = 1;
    const result = parseControlsFile(changed);
    if (!result.ok) throw new Error(result.error.message);
    const record = result.value.records.find((r) => r.action === 'ShiftUp')!;
    expect(record.binding).toMatchObject({ kind: 'button', buttons: [4] });
    expect(record.understood).toBe(false);
  });

  it('writes an unknown kind back as its type alone', () => {
    const data = encodeRecordData(1, 6, { kind: 'unknown', type: 16 });
    expect(data).toHaveLength(RECORD_BYTES);
    expect(Array.from(data.subarray(0, 12))).toEqual([1, 0, 0, 0, 6, 0, 0, 0, 16, 0, 0, 0]);
    expect(data.subarray(12).every((b) => b === 0)).toBe(true);
  });

  it('ignores a button number that does not fit the 128 bits', () => {
    const data = encodeRecordData(0, 6, {
      kind: 'button',
      buttons: [3, 128, -1],
      instanceGuid: WHEEL,
      productGuid: WHEEL_PRODUCT,
    });
    expect(data[12]).toBe(0b1000);
    expect(data.subarray(13, 28).every((b) => b === 0)).toBe(true);
  });
});

describe('iRacing controls.cfg, files that are not one', () => {
  const text = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('refuses other content with a plain message and never throws', async () => {
    const bytes = await read();
    const cases: [string, Uint8Array, string][] = [
      ['empty', new Uint8Array(0), 'GFCC'],
      ['text', text('not a controls file at all'), 'GFCC'],
      ['header only', bytes.slice(0, 64), 'LRTC'],
      ['cut in the middle of a record', bytes.slice(0, 5000), 'longer than the file'],
    ];
    for (const [name, content, detail] of cases) {
      const result = parseControlsFile(content);
      expect(result.ok, name).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('iracing-bindings.file');
      expect(result.error.message).toBe(
        'This is not an iRacing bindings file RigReady can read, or it is damaged.'
      );
      expect(result.error.detail, name).toContain(detail);
    }
  });

  it('refuses a chunk whose length does not end on a record', async () => {
    const bytes = (await read()).slice();
    const chunk = Buffer.from(bytes).indexOf('LRTC');
    // Ten bytes fewer: the last record no longer fits.
    const length = Buffer.from(bytes).readUInt32LE(chunk + 8) - 10;
    Buffer.from(bytes.buffer).writeUInt32LE(length, chunk + 8);
    const result = parseControlsFile(bytes);
    expect(!result.ok && result.error.detail).toContain('is not a name and 68 bytes');
  });

  it('refuses a name that is not plain text, an empty chunk and a chunk header cut short', async () => {
    const bytes = await read();
    const chunk = Buffer.from(bytes).indexOf('LRTC');
    const noName = bytes.slice();
    noName[chunk + 12] = 0x01;
    const first = parseControlsFile(noName);
    expect(!first.ok && first.error.detail).toContain('has no name');

    const empty = bytes.slice(0, chunk + 12);
    Buffer.from(empty.buffer).writeUInt32LE(0, chunk + 8);
    const second = parseControlsFile(empty);
    expect(!second.ok && second.error.detail).toContain('holds no records');

    const cut = parseControlsFile(bytes.slice(0, chunk + 6));
    expect(!cut.ok && cut.error.detail).toContain('LRTC');
  });
});

describe('device ids in iRacing files', () => {
  it('turns a GUID into the bytes Windows stores, and back', async () => {
    const { file } = await parsed();
    const throttle = file.records.find((r) => r.action === 'Throttle')!;
    expect(Buffer.from(guidBytes(WHEEL)).equals(Buffer.from(throttle.data.subarray(20, 36)))).toBe(
      true
    );
    expect(Array.from(guidBytes(`{${WHEEL.toLowerCase()}}`))).toEqual(Array.from(guidBytes(WHEEL)));
    // Not a GUID: sixteen zero bytes, never a throw.
    expect(guidBytes('nonsense').every((b) => b === 0)).toBe(true);
  });

  it('reads the USB ids out of a product GUID', () => {
    expect(usbIdsOf(WHEEL_PRODUCT)).toEqual({ vendorId: '0EB7', productId: '0007' });
    expect(usbIdsOf(`{${WHEEL_PRODUCT.toLowerCase()}}`)).toEqual({
      vendorId: '0EB7',
      productId: '0007',
    });
    // A device that is not a HID one has another kind of product GUID.
    expect(usbIdsOf('6F1D2B60-D5A0-11CF-BFC7-444553540000')).toBeUndefined();
  });
});
