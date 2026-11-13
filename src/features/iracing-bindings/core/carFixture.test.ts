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

/**
 * The per-car file of the scenario tests (fixtures/scenarios/data/iracing-bindings/
 * controls-car.cfg) is made up: no car on the recorded rig has custom controls. It is the
 * recorded file for all cars with the eight records below changed, and this test holds it
 * to that, so nobody has to trust a binary file they cannot read.
 */
const WHEEL = '20B0BED0-03A4-11F1-8001-444553540000';
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
