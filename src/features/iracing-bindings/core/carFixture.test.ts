import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import {
  encodeControlsFile,
  encodeRecordData,
  parseControlsFile,
  type Binding,
} from './controlsFile';
import { changeBinding } from './edit';

/**
 * The per-car file of the scenario tests (fixtures/scenarios/data/iracing-bindings/
 * controls-car.cfg) is made up: no car on the recorded rig has custom controls. It is the
 * recorded file for all cars with the eight records below changed, and this test holds it
 * to that, so nobody has to trust a binary file they cannot read.
 */
const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const WHEEL_PRODUCT = '00070EB7-0000-0000-0000-504944564944';
/** Invented devices with test ids (1209:0001 and 1209:0002). */
const BOX = '5EED0001-7A11-11EF-8004-444553540000';
const BOX_PRODUCT = '00011209-0000-0000-0000-504944564944';
const HANDBRAKE = '5EED0002-7A11-11EF-8005-444553540000';
const HANDBRAKE_PRODUCT = '00021209-0000-0000-0000-504944564944';

const button = (instanceGuid: string, productGuid: string, n: number): Binding => ({
  kind: 'button',
  buttons: [n],
  instanceGuid,
  productGuid,
});

const CHANGES: Record<string, Binding> = {
  BrakeBiasInc: button(BOX, BOX_PRODUCT, 0),
  BrakeBiasDec: button(BOX, BOX_PRODUCT, 1),
  TractionControlInc: button(BOX, BOX_PRODUCT, 2),
  TractionControlDec: button(BOX, BOX_PRODUCT, 3),
  // Two actions on one wheel button: an input that does two things.
  PitSpeedLimiter: button(WHEEL, WHEEL_PRODUCT, 6),
  HeadlightFlash: button(WHEEL, WHEEL_PRODUCT, 6),
  Handbrake: {
    kind: 'axis',
    axis: 0,
    instanceGuid: HANDBRAKE,
    productGuid: HANDBRAKE_PRODUCT,
    direction: 0,
  },
  LookLeft: { kind: 'none' },
};

const read = async (...parts: string[]): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(path.join(fixturesDir, ...parts)));

describe('the made-up car file of the scenario tests', () => {
  it('is the recorded file for all cars with exactly eight records changed', async () => {
    const general = await read(
      'rigs',
      'mark-full',
      'files',
      'Documents',
      'iRacing',
      'controls.cfg'
    );
    const car = await read('scenarios', 'data', 'iracing-bindings', 'controls-car.cfg');
    const file = parseControlsFile(general);
    if (!file.ok) throw new Error(file.error.message);
    let changed = 0;
    for (const record of file.value.records) {
      const to = CHANGES[record.action];
      if (!to) continue;
      record.data = encodeRecordData(record.flag, record.mask, to);
      changed++;
    }
    expect(changed).toBe(8);
    expect(Buffer.from(encodeControlsFile(file.value)).equals(Buffer.from(car))).toBe(true);

    // Read back, the car file says what was put in, and all of it is understood.
    const again = parseControlsFile(car);
    if (!again.ok) throw new Error(again.error.message);
    for (const record of again.value.records) {
      expect(record.understood, record.action).toBe(true);
      const to = CHANGES[record.action];
      if (to) expect(record.binding, record.action).toEqual(to);
    }
  });
});

/**
 * The control profile of the scenario tests (profile-controls.cfg) is the owner's real
 * Documents\iRacing\profiles\controls\Baseline\controls.cfg of 13 Nov 2026, written by
 * iRacing 2026.11 on its first run, with the made-up wheel id of the recorded rig in place
 * of the real one. This holds it to what iRacing did to the older file when it made it.
 */
describe('the control profile of the scenario tests', () => {
  it('is the recorded file with two new actions, no bytes after them, and a new size', async () => {
    const older = parseControlsFile(
      await read('rigs', 'mark-full', 'files', 'Documents', 'iRacing', 'controls.cfg')
    );
    const bytes = await read('scenarios', 'data', 'iracing-bindings', 'profile-controls.cfg');
    const profile = parseControlsFile(bytes);
    if (!older.ok || !profile.ok) throw new Error('a fixture cannot be read');
    expect(profile.value.records).toHaveLength(369);
    const before = new Map(older.value.records.map((r) => [r.action, r]));
    const added = profile.value.records.filter((r) => !before.has(r.action));
    expect(added.map((r) => r.action)).toEqual(['PitSummaryToggle', 'ToggleUIVisibleDrive']);
    for (const record of added) {
      expect(record).toMatchObject({ flag: 1, mask: 0x06, binding: { kind: 'none' } });
    }
    // Every older action is there, in the same order, with the same 68 bytes.
    const kept = profile.value.records.filter((r) => before.has(r.action));
    expect(kept.map((r) => r.action)).toEqual(older.value.records.map((r) => r.action));
    for (const record of kept) {
      expect(Buffer.from(record.data).equals(Buffer.from(before.get(record.action)!.data))).toBe(
        true
      );
    }
    expect(profile.value.records.every((r) => r.understood)).toBe(true);
    // The older file ends in two bytes after its last record; the profile ends with it.
    expect(Array.from(older.value.tail)).toEqual([0x20, 0x20]);
    expect(profile.value.tail).toHaveLength(0);
    // The header is the same but for the size at 8 (the file's size less 12).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(8, true)).toBe(bytes.length - 12);
    const head = Array.from(profile.value.head);
    const olderHead = Array.from(older.value.head);
    expect(head.length).toBe(olderHead.length);
    const differ = head.map((b, i) => (b === olderHead[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differ.every((i) => (i >= 8 && i < 12) || i >= head.length - 4)).toBe(true);
    // Read and written again, it is the same file.
    expect(Buffer.from(encodeControlsFile(profile.value)).equals(Buffer.from(bytes))).toBe(true);
  });
});

/**
 * The car's control profile of the scenario tests (profile-car-controls.cfg) is the owner's
 * real Documents\iRacing\profiles\controls\Test Profile CTSV\controls.cfg, which iRacing
 * 2026.11 wrote at 12:27 on 13 Nov 2026 when a profile was made in its Options and given to
 * the Cadillac CTS-V. It copied the Baseline profile as it was then: with the two bindings
 * RigReady had written at 12:16 and iRacing had used in a test drive.
 */
describe('the car profile of the scenario tests', () => {
  it('is Baseline with exactly the two bindings RigReady wrote, byte for byte', async () => {
    const baseline = await read('scenarios', 'data', 'iracing-bindings', 'profile-controls.cfg');
    const car = await read('scenarios', 'data', 'iracing-bindings', 'profile-car-controls.cfg');
    const lookUp = changeBinding(baseline, 'LookUp', {
      kind: 'button',
      instanceGuid: WHEEL,
      productGuid: WHEEL_PRODUCT,
      // Button 10 as the page shows it.
      button: 9,
    });
    if (!lookUp.ok) throw new Error(lookUp.error.message);
    const both = changeBinding(lookUp.value.bytes, 'ToggleUIVisibleDrive', {
      kind: 'key',
      keyCode: 74,
      modifiers: 0x03,
    });
    if (!both.ok) throw new Error(both.error.message);
    // What RigReady's writer gives is what iRacing kept and copied into the new profile.
    expect(Buffer.from(both.value.bytes).equals(Buffer.from(car))).toBe(true);
  });
});
