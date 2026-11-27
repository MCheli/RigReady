import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ChangeResult, TuneReview, Tuning } from '../contract';
import { REGISTRY_KEY } from './view';

/**
 * The axes of a controller tuned in the calibration Nuclear Option saved, on
 * fixtures/scenarios/nuclear-option-bindings.yaml: shown first, written through FileStore
 * (a backup, the Safety page, Undo), refused while the game runs.
 */
const STICK = 'controller:044F:0402:0';
const THROTTLE = 'controller:044F:0404:0';
const PEDALS = 'controller:044F:B679:0';

describe('tuning the axes of a controller for Nuclear Option', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });
  const start = async (): Promise<WiredApp> => (app = await wiredApp('nuclear-option-bindings'));
  const tuning = (a: WiredApp, device: string): Promise<Tuning> =>
    a.invoke<Tuning>('nuclear-option-bindings:tuning', { device });
  const review = (a: WiredApp, request: object): Promise<TuneReview> =>
    a.invoke<TuneReview>('nuclear-option-bindings:tunePreview', request);
  const tune = (a: WiredApp, request: object): Promise<ChangeResult> =>
    a.invoke<ChangeResult>('nuclear-option-bindings:tune', request);
  const values = async (a: WiredApp): Promise<Record<string, { type: string; value: unknown }>> => {
    const all = await a.ports.registry.listValues('HKCU', REGISTRY_KEY);
    if (!all.ok) throw new Error(all.error.message);
    return all.value as Record<string, { type: string; value: unknown }>;
  };
  const changedNames = async (
    a: WiredApp,
    before: Record<string, { value: unknown }>
  ): Promise<string[]> =>
    Object.entries(await values(a))
      .filter(([name, v]) => before[name]?.value !== v.value)
      .map(([name]) => /hardwareIdentifier=([^|]+)/.exec(name)?.[1] ?? name);

  it('lists a plugged-in controller’s own axes by name with how each is tuned, from the calibration the game uses', async () => {
    const a = await start();
    const before = await values(a);
    // The stick has two saved calibrations: the one the current game saved is read.
    expect(await tuning(a, STICK)).toEqual({
      device: 'Joystick - HOTAS Warthog',
      named: true,
      axes: [
        {
          index: 0,
          name: 'X axis',
          tunable: true,
          unread: false,
          deadZone: 0.1,
          upperDeadZone: 0,
          sensitivity: 1,
          reversed: false,
        },
        {
          index: 1,
          name: 'Y axis',
          tunable: true,
          unread: false,
          deadZone: 0.05,
          upperDeadZone: 0.02,
          sensitivity: 0.8,
          reversed: false,
        },
      ],
    });
    // The throttle's is an earlier build's: no upper dead zone; its third axis is reversed.
    const throttle = await tuning(a, THROTTLE);
    expect(throttle.axes.map((x) => x.name)).toEqual([
      'X axis',
      'Y axis',
      'Z axis',
      'Z rotation',
      'Slider 1',
    ]);
    expect(throttle.axes[2]).toEqual({
      index: 2,
      name: 'Z axis',
      tunable: true,
      unread: false,
      deadZone: 0,
      sensitivity: 1,
      reversed: true,
    });
    expect(await values(a)).toEqual(before);
  });

  it('shows the change first and writes nothing; Save writes one value after a backup, and Undo puts it back', async () => {
    const a = await start();
    const before = await values(a);
    const request = {
      device: STICK,
      axis: 0,
      deadZone: 0.03,
      upperDeadZone: 0.05,
      sensitivity: 0.75,
    };
    const shown = await review(a, request);
    expect(shown).toMatchObject({
      device: 'Joystick - HOTAS Warthog',
      axis: 'X axis',
      before: 'dead zone 10 %, upper dead zone 0 %, sensitivity 1',
      after: 'dead zone 3 %, upper dead zone 5 %, sensitivity 0.75',
      same: false,
    });
    expect(shown.blocked).toBeUndefined();
    expect(shown.preview.files[0]).toMatchObject({
      label: 'Nuclear Option’s saved calibration for Joystick - HOTAS Warthog (registry)',
      change: 'modified',
    });
    expect(await values(a)).toEqual(before);

    const saved = await tune(a, { ...request, seen: shown.seen });
    expect(saved).toEqual({
      changed: true,
      message:
        'Saved: X axis of Joystick - HOTAS Warthog now has dead zone 3 %, upper dead zone 5 %, sensitivity 0.75. Undo is on the Safety page.',
    });
    // Only the calibration the game uses for the stick changed, not the older one beside it.
    expect(await changedNames(a, before)).toEqual(['WindowsRawInputJoystick-HOTASWarthog0402044F']);
    expect((await tuning(a, STICK)).axes[0]).toMatchObject({
      deadZone: 0.03,
      upperDeadZone: 0.05,
      sensitivity: 0.75,
    });
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value).toHaveLength(1);
    expect(journal.value[0]!.reason).toBe(
      'Nuclear Option axis tuning: X axis of Joystick - HOTAS Warthog: dead zone 3 %, upper dead zone 5 %, sensitivity 0.75'
    );
    const backup = await fs.readFile(journal.value[0]!.entries[0]!.backupPath!, 'utf8');
    expect(backup).toContain('<deadZone>0.1</deadZone><upperDeadZone>0</upperDeadZone>');

    // Saved again, nothing is written.
    expect(await tune(a, request)).toEqual({
      changed: false,
      message: 'Nothing was changed: X axis of Joystick - HOTAS Warthog is tuned so already.',
    });
    expect((await a.ports.files.journalGroups()).ok).toBe(true);
    await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
    expect(await values(a)).toEqual(before);
  });

  it('tunes an axis of an older calibration without an upper dead zone', async () => {
    const a = await start();
    const before = await values(a);
    const saved = await tune(a, { device: THROTTLE, axis: 4, deadZone: 0, sensitivity: 1.2 });
    expect(saved.message).toBe(
      'Saved: Slider 1 of Throttle - HOTAS Warthog now has dead zone 0 %, sensitivity 1.2. Undo is on the Safety page.'
    );
    expect((await changedNames(a, before)).length).toBe(1);
    await expect(
      tune(a, { device: THROTTLE, axis: 4, deadZone: 0, upperDeadZone: 0.1, sensitivity: 1 })
    ).rejects.toThrow('has no upper dead zone');
  });

  it('is refused while the game runs, when the calibration changed after it was shown, and writes nothing then', async () => {
    const a = await start();
    const request = { device: STICK, axis: 0, deadZone: 0.03, sensitivity: 1 };
    const shown = await review(a, request);
    // Meanwhile another axis was saved (as the game would from its own window).
    await tune(a, { device: STICK, axis: 1, deadZone: 0.2, sensitivity: 1 });
    const between = await values(a);
    await expect(tune(a, { ...request, seen: shown.seen })).rejects.toThrow(
      'changed after the change was shown'
    );
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    expect((await review(a, request)).blocked).toContain('Close Nuclear Option first');
    await expect(tune(a, request)).rejects.toThrow('Close Nuclear Option first');
    expect(await values(a)).toEqual(between);
  });

  it('refuses a controller without a saved calibration, the keyboard, an axis the calibration lacks and values out of range', async () => {
    const a = await start();
    const before = await values(a);
    // The pedals have saved bindings but no calibration in the scenario.
    await expect(tuning(a, PEDALS)).rejects.toThrow('has saved no calibration for this controller');
    await expect(tuning(a, 'keyboard')).rejects.toThrow(
      'RigReady tunes the axes of a controller the game has saved bindings for'
    );
    await expect(tuning(a, 'controller:1234:5678:0')).rejects.toThrow('RigReady tunes the axes');
    await expect(
      tune(a, { device: STICK, axis: 0, deadZone: 0.95, sensitivity: 1 })
    ).rejects.toThrow('A dead zone is 0 to 80 percent');
    await expect(
      tune(a, { device: STICK, axis: 0, deadZone: 0.1, sensitivity: 2.5 })
    ).rejects.toThrow('the sensitivity 0.1 to 2');
    await expect(
      tune(a, { device: STICK, axis: 40, deadZone: 0.1, sensitivity: 1 })
    ).rejects.toThrow();
    expect(await values(a)).toEqual(before);
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('an unplugged controller’s axes go by the game’s numbers, and an axis in a shape RigReady does not read is said to be unread', async () => {
    const a = await start();
    const all = await values(a);
    const name = Object.keys(all).find(
      (n) => n.includes('dataType=CalibrationMap') && n.includes('HOTASWarthog0402044F')
    )!;
    // The first axis as a later game build might save it: with a field this code has not seen.
    const text = Buffer.from(all[name]!.value as string, 'hex').toString('utf8');
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name,
        value: {
          type: 'binary',
          value: Buffer.from(
            text.replace(
              '<enabled>true</enabled>',
              '<enabled>true</enabled><smoothing>2</smoothing>'
            ),
            'utf8'
          ).toString('hex'),
        },
      },
      { op: 'unplugDevice', match: { vendorId: '044F', productId: '0402' } },
    ]);
    const stick = await tuning(a, STICK);
    expect(stick.named).toBe(false);
    expect(stick.axes.map((x) => x.name)).toEqual([
      'Axis 0',
      'Axis 1',
      'Axis 2',
      'Axis 3',
      'Axis 4',
      'Axis 5',
      'Axis 6',
      'Axis 7',
    ]);
    expect(stick.axes[0]).toMatchObject({ unread: true, tunable: false });
    expect(stick.axes[1]).toMatchObject({ unread: false, tunable: true, deadZone: 0.05 });
    await expect(
      tune(a, { device: STICK, axis: 0, deadZone: 0.03, sensitivity: 1 })
    ).rejects.toThrow('saved in a way RigReady does not understand');
    // The axis after it is still tuned, unplugged or not.
    expect(
      (await tune(a, { device: STICK, axis: 1, deadZone: 0.03, sensitivity: 0.8 })).message
    ).toBe(
      'Saved: Axis 1 of Joystick - HOTAS Warthog now has dead zone 3 %, upper dead zone 2 %, sensitivity 0.8. Undo is on the Safety page.'
    );
  });

  it('with two controllers of one model nothing is read or written: the calibration does not say whose it is', async () => {
    const a = await start();
    const all = await values(a);
    const map = Object.keys(all).find(
      (n) => n.includes('dataType=ControllerMap|') && n.includes('HOTASWarthog0402044F')
    )!;
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name: map.replace('duplicate=0', 'duplicate=1').replace(/_h\d+$/, '_h1100000098'),
        value: all[map]!,
      },
    ]);
    const before = await values(a);
    await expect(tuning(a, STICK)).rejects.toThrow('Two controllers of this model');
    await expect(
      tune(a, { device: STICK, axis: 0, deadZone: 0.03, sensitivity: 1 })
    ).rejects.toThrow('Two controllers of this model');
    expect(await values(a)).toEqual(before);
  });

  it('two saved calibrations of one form for a controller are not chosen between', async () => {
    const a = await start();
    const all = await values(a);
    const name = Object.keys(all).find(
      (n) => n.includes('dataType=CalibrationMap') && n.includes('HOTASWarthog0402044F')
    )!;
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name: name.replace(/_h\d+$/, '_h1100000099'),
        value: all[name]!,
      },
    ]);
    await expect(tuning(a, STICK)).rejects.toThrow('has saved two calibrations');
    await expect(
      tune(a, { device: STICK, axis: 0, deadZone: 0.03, sensitivity: 1 })
    ).rejects.toThrow('has saved two calibrations');
  });
});
