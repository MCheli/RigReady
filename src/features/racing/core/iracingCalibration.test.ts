import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { DeviceNames } from '../../../core/names';
import type { InputDevice } from '../../../shared/models';
import type { CalibratedDevice } from './iracing/joyCalib';
import {
  CALIBRATION_TITLE,
  IRACING_CALIBRATION,
  calibrationOutcome,
  gearCalibration,
  racingGearOf,
} from './iracingCalibration';

/**
 * "Wheel and pedals calibrated in iRacing", through the Play screen's own check run, on the
 * owner's control profile with the recorded rig's made-up wheel id.
 */

const SETUP = 'racing-iracing-calibration';
const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const WHEEL_PRODUCT = '00070EB7-0000-0000-0000-504944564944';
const NO_NAMES: DeviceNames = { nameOf: () => undefined };

interface Result {
  type: string;
  status: string;
  summary: string;
  details: string[];
  required: boolean;
}

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});
const start = async (scenario: string): Promise<WiredApp> =>
  (app = await wiredApp(scenario, { files: ['Documents/iRacing/**'] }));
async function checked(a: WiredApp): Promise<Result> {
  const report = await a.invoke<{ results: Result[] }>('fly:check', { profileId: SETUP });
  return report.results.find((r) => r.type === IRACING_CALIBRATION)!;
}
const calibrationFile = (a: WiredApp): string =>
  path.join(
    a.ports.folders.documents(),
    'iRacing',
    'profiles',
    'controls',
    'Baseline',
    'joyCalib.yaml'
  );

describe('iRacing calibration check: on the Play screen', () => {
  it('passes when the wheel plugged in now is calibrated in the profile iRacing uses', async () => {
    const a = await start('racing-iracing-calibrated');
    expect(await checked(a)).toMatchObject({
      status: 'pass',
      required: false,
      summary:
        'FANATEC Podium Wheel Base DD2 is calibrated in iRacing (control profile “Baseline”)',
    });
  });

  it('warns, in plain words, about pedals plugged in now that iRacing has not calibrated', async () => {
    const a = await start('racing-iracing-uncalibrated');
    expect(await checked(a)).toEqual(
      expect.objectContaining({
        status: 'warn',
        summary: 'Not calibrated in iRacing (control profile “Baseline”): Load Cell Pedals',
        details: [
          'iRacing has no calibration for Load Cell Pedals, so it will ask you to calibrate it. Calibrate in iRacing: Options, then Controls.',
        ],
      })
    );
  });

  it('reads the profile iRacing uses, never the older joyCalib.yaml beside it', async () => {
    const a = await start('racing-iracing-calibrated');
    // The older file still names the wheel; the profile no longer does.
    await fs.writeFile(calibrationFile(a), '---\r\nCalibrationInfo:\r\n DeviceList:\r\n...\r\n');
    const result = await checked(a);
    expect(result.status).toBe('warn');
    expect(result.summary).toBe(
      'Not calibrated in iRacing (control profile “Baseline”): FANATEC Podium Wheel Base DD2'
    );
  });

  it('says iRacing will ask to calibrate when the profile has no calibration file yet', async () => {
    const a = await start('racing-iracing-calibrated');
    await fs.rm(calibrationFile(a));
    expect((await checked(a)).details).toEqual([
      'iRacing has no calibration for FANATEC Podium Wheel Base DD2, so it will ask you to calibrate it. Calibrate in iRacing: Options, then Controls.',
    ]);
  });

  it('a calibration under an older Windows id points to the id repair', async () => {
    const a = await start('racing-iracing-calibrated');
    await mutate(a, [
      {
        op: 'setController',
        match: { vendorId: '0EB7', productId: '0007' },
        set: { guid: 'A1B2C3D4-5E6F-11F1-8001-444553540000' },
      },
    ]);
    const result = await checked(a);
    expect(result.status).toBe('warn');
    expect(result.details).toEqual([
      'FANATEC Podium Wheel Base DD2 is calibrated under an older Windows id, so iRacing will ask you to calibrate it again. Open Configure › Racing › iRacing to point iRacing at the new id, or calibrate in iRacing: Options, then Controls.',
    ]);
  });

  it('says so when no wheel or pedals are plugged in, and when the file cannot be read', async () => {
    const a = await start('racing-iracing-calibrated');
    await fs.writeFile(calibrationFile(a), 'not a calibration file');
    expect(await checked(a)).toMatchObject({
      status: 'error',
      summary: 'RigReady could not read iRacing’s calibration file',
    });
    await mutate(a, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    expect(await checked(a)).toMatchObject({
      status: 'warn',
      summary: 'No wheel or pedals are plugged in',
    });
  });

  it('says so when it cannot tell which profile iRacing uses, or cannot list the controllers', async () => {
    const a = await start('racing-iracing-calibrated');
    await mutate(a, [{ op: 'failProvider', port: 'input', message: 'No input reader.' }]);
    expect(await checked(a)).toMatchObject({ status: 'error', summary: 'No input reader.' });
    await mutate(a, [
      { op: 'failProvider', port: 'input', fail: false },
      { op: 'writeFile', path: 'Documents/iRacing/app.ini', content: '[Audio]\r\nvolume=1\r\n' },
    ]);
    expect(await checked(a)).toMatchObject({
      status: 'warn',
      summary: 'RigReady cannot tell which control profile iRacing uses',
      details: [
        'iRacing keeps control profiles, but app.ini names none for all cars, so RigReady cannot tell which bindings iRacing uses.',
      ],
    });
  });

  it('is offered in a new setup made on a PC with iRacing and a wheel, as a warning', async () => {
    // iRacing's program, so that iRacing counts as installed.
    const a = (app = await wiredApp('racing-iracing-calibrated', {
      files: ['Documents/iRacing/**', 'Program Files (x86)/iRacing/**'],
    }));
    const { candidates } = await a.invoke<{
      candidates: { key: string; game?: string; selectedByDefault: boolean; check: unknown }[];
    }>('profiles:capture');
    expect(candidates.find((c) => c.key === 'racing:iracing-calibration')).toEqual({
      key: 'racing:iracing-calibration',
      game: 'iracing',
      group: 'files',
      title: CALIBRATION_TITLE,
      description: 'Warns before iRacing asks you to calibrate the wheel or pedals',
      selectedByDefault: true,
      icon: 'mdi-tune-variant',
      check: { type: IRACING_CALIBRATION, title: CALIBRATION_TITLE, required: false, params: {} },
    });
  });

  it('is not offered on a PC with no wheel or pedals', async () => {
    const a = (app = await wiredApp('flying-fresh', {
      files: ['Documents/iRacing/**', 'Program Files (x86)/iRacing/**'],
    }));
    await mutate(a, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    const { candidates } = await a.invoke<{ candidates: { key: string }[] }>('profiles:capture');
    expect(candidates.some((c) => c.key === 'racing:iracing-calibration')).toBe(false);
  });
});

const controller = (patch: Partial<InputDevice>): InputDevice => ({
  index: 0,
  name: 'Controller',
  guid: '5EED00C1-7A11-11EF-8001-444553540000',
  productGuid: '',
  vendorId: '',
  productId: '',
  numAxes: 3,
  numButtons: 0,
  numHats: 0,
  axisNames: [],
  ...patch,
});
const entry = (instanceGuid: string, productGuid: string, max = 65535): CalibratedDevice => ({
  name: 'x',
  instanceGuid,
  productGuid,
  axes: [{ axis: 0, name: 'Wheel Axis', min: 0, center: 33145, max }],
});
const wheel = controller({
  name: 'FANATEC Podium Wheel Base DD2',
  guid: WHEEL,
  productGuid: WHEEL_PRODUCT,
  vendorId: '0EB7',
  productId: '0007',
});

describe('iRacing calibration check: what counts', () => {
  it('a wheel base, racing pedals and a wheel by name; never flight rudder pedals or other gear', () => {
    expect(racingGearOf(wheel, NO_NAMES)).toBe('wheel');
    expect(racingGearOf(controller({ name: 'Load Cell Pedals' }), NO_NAMES)).toBe('pedals');
    expect(racingGearOf(controller({ name: 'Simucube 2 Pro' }), NO_NAMES)).toBe('wheel');
    for (const name of ['T-Pendular-Rudder', 'Thrustmaster TPR Rudder', 'MFG Crosswind V3']) {
      expect(racingGearOf(controller({ name }), NO_NAMES), name).toBeUndefined();
    }
    for (const name of ['WINWING Orion Joystick Base 2 + JGRIP-F16', 'Button Box', 'SHH Shifter']) {
      expect(racingGearOf(controller({ name }), NO_NAMES), name).toBeUndefined();
    }
  });

  it('what the owner said on the Devices page wins over the name and the table', () => {
    const said = (kind: string | undefined, usedFor?: string): DeviceNames => ({
      nameOf: () => undefined,
      whatIs: () =>
        ({ ...(kind ? { kind } : {}), ...(usedFor ? { usedFor } : {}) }) as ReturnType<
          NonNullable<DeviceNames['whatIs']>
        >,
    });
    const box = controller({ name: 'Button Box', vendorId: '1209', productId: '0001' });
    expect(racingGearOf(box, said('pedals'))).toBe('pedals');
    expect(racingGearOf(wheel, said('panel'))).toBeUndefined();
    // Said to be flight gear: left out whatever it is.
    expect(racingGearOf(wheel, said(undefined, 'flight'))).toBeUndefined();
    expect(racingGearOf(wheel, said('wheel', 'flight'))).toBeUndefined();
  });

  it('matches by the instance id Windows gives now, and needs an axis with a range', () => {
    expect(gearCalibration([wheel], [entry(WHEEL, WHEEL_PRODUCT)], NO_NAMES)).toEqual([
      expect.objectContaining({ name: 'FANATEC Podium Wheel Base DD2', state: 'calibrated' }),
    ]);
    // An entry with nothing measured is not a calibration.
    expect(gearCalibration([wheel], [entry(WHEEL, WHEEL_PRODUCT, 0)], NO_NAMES)[0]!.state).toBe(
      'missing'
    );
    // The same model under another id: an older Windows id.
    const other = entry('A1B2C3D4-5E6F-11F1-8001-444553540000', WHEEL_PRODUCT);
    expect(gearCalibration([wheel], [other], NO_NAMES)[0]!.state).toBe('old-id');
    expect(gearCalibration([wheel], [], NO_NAMES)[0]!.state).toBe('missing');
  });

  it('judges a base that shows up as two controllers of one USB device once: calibrated when one of them is', () => {
    const usb = 'USB\\VID_0EB7&PID_0007\\6&2C41A7F0&0&4';
    const one = { ...wheel, usbInstanceId: usb };
    const second = {
      ...wheel,
      index: 1,
      guid: '45D4BEA1-60A1-17D8-8002-444553540000',
      usbInstanceId: usb,
    };
    expect(gearCalibration([one, second], [entry(WHEEL, WHEEL_PRODUCT)], NO_NAMES)).toEqual([
      expect.objectContaining({ state: 'calibrated' }),
    ]);
  });

  it('never takes two units of one model for one: each pedal set must be calibrated', () => {
    const product = '5ED11209-0000-0000-0000-504944564944';
    const pedals = (guid: string, usbInstanceId?: string): InputDevice =>
      controller({
        name: 'Load Cell Pedals',
        guid,
        productGuid: product,
        vendorId: '1209',
        productId: '5ED1',
        ...(usbInstanceId ? { usbInstanceId } : {}),
      });
    const calibrated = '5EED00C1-7A11-11EF-8001-444553540000';
    const other = '5EED00C2-7A11-11EF-8002-444553540000';
    // Windows says they are two USB devices.
    const two = [
      pedals(calibrated, 'USB\\VID_1209&PID_5ED1\\6&1&0&1'),
      pedals(other, 'USB\\VID_1209&PID_5ED1\\6&1&0&2'),
    ];
    // Or it does not say: then each controller counts on its own.
    const unsaid = [pedals(calibrated), pedals(other)];
    for (const live of [two, unsaid]) {
      // The second is not the first under a new id: the first is plugged in with its own.
      expect(
        gearCalibration(live, [entry(calibrated, product)], NO_NAMES).map((g) => g.state)
      ).toEqual(['calibrated', 'missing']);
    }
  });

  it('uses the name the owner gave a device', () => {
    const names: DeviceNames = { nameOf: () => 'The big wheel' };
    expect(calibrationOutcome(gearCalibration([wheel], [], names)).summary).toBe(
      'Not calibrated in iRacing: The big wheel'
    );
  });

  it('names several at once, and says "them"', () => {
    const outcome = calibrationOutcome([
      { name: 'Wheel', gear: 'wheel', state: 'missing' },
      { name: 'Pedals', gear: 'pedals', state: 'missing' },
      { name: 'Shifter', gear: 'pedals', state: 'calibrated' },
    ]);
    expect(outcome).toEqual({
      pass: false,
      summary: 'Not calibrated in iRacing: Wheel and Pedals',
      details: [
        'iRacing has no calibration for Wheel and Pedals, so it will ask you to calibrate them. Calibrate in iRacing: Options, then Controls.',
      ],
    });
    expect(
      calibrationOutcome([
        { name: 'Wheel', gear: 'wheel', state: 'calibrated' },
        { name: 'Pedals', gear: 'pedals', state: 'calibrated' },
      ]).summary
    ).toBe('Wheel and Pedals are calibrated in iRacing');
  });
});
