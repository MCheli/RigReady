import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { IracingView } from '../../contract';
import { guidToBytes, parseControlsCfg, replaceGuidBytes, devicesInControls } from './controlsCfg';
import { suggestTarget } from './iracing';
import { parseJoyCalib, replaceGuidText } from './joyCalib';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './labels';

const recorded = path.join(fixturesDir, 'rigs', 'mark-full', 'files', 'Documents', 'iRacing');
const DD2 = '45D4BEA1-60A1-17D8-8001-444553540000';
const DD2_PRODUCT = '00070EB7-0000-0000-0000-504944564944';
/** An id Windows might have handed the same wheel before a USB port change. */
const OLD = '11112222-3333-11F1-8001-444553540000';

const readRecorded = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(path.join(recorded, name)));

describe('controls.cfg', () => {
  it('reads every record of the recorded file and the 17 bindings on the DD2', async () => {
    const bytes = await readRecorded('controls.cfg');
    const parsed = parseControlsCfg(bytes);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const { records } = parsed.value;
    expect(records).toHaveLength(367);
    // The last record ends two bytes before the end of the file, as in the research.
    expect(records.at(-1)!.offset + 68).toBe(bytes.length - 2);
    expect(records.find((r) => r.action === 'Throttle')!.binding).toEqual({
      kind: 'axis',
      axis: 2,
      instanceGuid: DD2,
      productGuid: DD2_PRODUCT,
      direction: 0,
    });
    expect(records.find((r) => r.action === 'ShiftUp')!.binding).toMatchObject({
      kind: 'button',
      buttons: [4],
    });
    expect(records.find((r) => r.action === 'Reset')!.binding).toMatchObject({
      kind: 'button',
      buttons: [25],
    });
    expect(records.find((r) => r.action === 'Ignition')!.binding).toEqual({
      kind: 'key',
      keyCode: 73,
      modifiers: 0,
    });
    const devices = devicesInControls(parsed.value);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ instanceGuid: DD2, productGuid: DD2_PRODUCT });
    expect(devices[0]!.actions).toHaveLength(17);
  });

  it('replacing a device id is byte-exact and reversible', async () => {
    const original = await readRecorded('controls.cfg');
    const changed = replaceGuidBytes(original, DD2, OLD);
    expect(changed.count).toBe(17);
    expect(changed.bytes.length).toBe(original.length);
    // Only the 16 bytes of each occurrence differ.
    let differing = 0;
    for (let i = 0; i < original.length; i++) if (original[i] !== changed.bytes[i]) differing++;
    expect(differing).toBeLessThanOrEqual(17 * 16);
    const reparsed = parseControlsCfg(changed.bytes);
    expect(reparsed.ok && devicesInControls(reparsed.value)[0]!.instanceGuid).toBe(OLD);
    const back = replaceGuidBytes(changed.bytes, OLD, DD2);
    expect(Buffer.from(back.bytes).equals(Buffer.from(original))).toBe(true);
  });

  it('refuses a file that is not an iRacing bindings file', () => {
    expect(parseControlsCfg(new TextEncoder().encode('not a controls file at all')).ok).toBe(false);
    const header = new Uint8Array(64);
    header.set(new TextEncoder().encode('GFCC'));
    const result = parseControlsCfg(header);
    expect(!result.ok && result.error.message).toContain('LRTC');
  });

  it('turns a GUID into the bytes Windows stores', () => {
    expect(Buffer.from(guidToBytes(DD2)).toString('hex')).toBe(
      'a1bed445a160d817800144455354' + '0000'
    );
    expect(() => guidToBytes('nope')).toThrow();
  });
});

describe('joyCalib.yaml', () => {
  it('lists the calibrated device and its axes', async () => {
    const text = await fs.readFile(path.join(recorded, 'joyCalib.yaml'), 'utf8');
    const parsed = parseJoyCalib(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value).toEqual([
      {
        name: 'FANATEC Podium Wheel Base DD2',
        instanceGuid: DD2,
        productGuid: DD2_PRODUCT,
        axes: [
          { axis: 0, name: 'Combined Pedals', min: 0, center: 65535, max: 65535 },
          { axis: 1, name: 'Brake', min: 0, center: 65535, max: 65535 },
          { axis: 2, name: 'Accelerator', min: 0, center: 65535, max: 65535 },
          { axis: 3, name: 'Wheel Axis', min: 0, center: 33145, max: 65535 },
        ],
      },
    ]);
    expect(parseJoyCalib('just: text').ok).toBe(false);
  });

  it('replacing the id changes nothing else in the text', async () => {
    const text = await fs.readFile(path.join(recorded, 'joyCalib.yaml'), 'utf8');
    const changed = replaceGuidText(text, DD2, OLD);
    expect(changed.count).toBe(1);
    expect(changed.text).toBe(text.replace(`{${DD2}}`, `{${OLD}}`));
    expect(replaceGuidText(changed.text, OLD.toLowerCase(), DD2).text).toBe(text);
  });
});

describe('labels', () => {
  it('names actions and keys in plain language', () => {
    expect(iracingActionLabel('SteerLeft')).toBe('Steer left');
    expect(iracingActionLabel('Throttle2')).toBe('Throttle (second binding)');
    expect(iracingActionLabel('Gear5')).toBe('Gear 5');
    expect(iracingActionLabel('BrakeBiasInc')).toBe('Brake bias up');
    expect(iracingActionLabel('MGUKDeployModeLevel')).toBe('MGU-K deploy mode (axis)');
    expect(iracingActionLabel('AutoChat3')).toBe('Chat macro 3');
    expect(iracingActionLabel('BlackBoxF4')).toBe('Black box 4');
    expect(iracingActionGroup('Throttle')).toBe('Driving');
    expect(iracingActionGroup('ABSInc')).toBe('In-car adjustments');
    expect(iracingActionGroup('RpyPausePlay')).toBe('Cameras and replay');
    expect(iracingActionGroup('TChatInitiate')).toBe('Interface and chat');
    expect(iracingKeyLabel(83, 63)).toBe('Ctrl+Alt+Shift+S');
    expect(iracingKeyLabel(197, 0)).toBe('F1');
    expect(iracingKeyLabel(38, 0)).toBe('Up');
  });

  it('names every key the way iRacing does, punctuation and the number pad included', async () => {
    // Brake bias and the camera step are on = and -, the field of view on [ and ].
    expect(iracingKeyLabel(114, 0)).toBe('=');
    expect(iracingKeyLabel(108, 0)).toBe('-');
    expect(iracingKeyLabel(118, 0x03)).toBe('Shift+[');
    expect(iracingKeyLabel(120, 0x0c)).toBe('Ctrl+]');
    expect(iracingKeyLabel(112, 0)).toBe(';');
    expect(iracingKeyLabel(102, 0)).toBe("'");
    expect(iracingKeyLabel(119, 0)).toBe('\\');
    expect(iracingKeyLabel(127, 0)).toBe('~');
    // The replay keys are on the number pad: 7 and 1 for the start and the end, 4 and 6 to step.
    expect(iracingKeyLabel(179, 0)).toBe('Num 7');
    expect(iracingKeyLabel(178, 0)).toBe('Num 1');
    expect(iracingKeyLabel(180, 0x0c)).toBe('Ctrl+Num 4');
    expect(iracingKeyLabel(182, 0x03)).toBe('Shift+Num 6');
    expect(iracingKeyLabel(12, 0)).toBe('Num 5');
    expect(iracingKeyLabel(185, 0)).toBe('Num .');
    expect(iracingKeyLabel(190, 0)).toBe('Num Enter');
    expect(iracingKeyLabel(212, 0)).toBe('F16');
    expect(iracingKeyLabel(27, 0)).toBe('Esc');
    expect(iracingKeyLabel(193, 0)).toBe('Right Ctrl');
    expect(iracingKeyLabel(128, 0)).toBe('¡');
    expect(iracingKeyLabel(172, 0)).toBe('ÿ');
    expect(iracingKeyLabel(232, 0)).toBe('Play/Pause');
    // A code iRacing has no key for stays a number rather than a guess.
    expect(iracingKeyLabel(173, 0)).toBe('Key 173');
    expect(iracingKeyLabel(95, 0)).toBe('Key 95');
    expect(iracingKeyLabel(243, 0)).toBe('Key 243');

    // No keyboard binding of the recorded file is left as a number.
    const parsed = parseControlsCfg(await readRecorded('controls.cfg'));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const keys = parsed.value.records.flatMap((r) =>
      r.binding.kind === 'key'
        ? [{ action: r.action, key: iracingKeyLabel(r.binding.keyCode, r.binding.modifiers) }]
        : []
    );
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k) => /Key d+/.test(k.key))).toEqual([]);
    const of = (action: string): string | undefined => keys.find((k) => k.action === action)?.key;
    expect(of('BrakeBiasInc')).toBe('=');
    expect(of('RpyToStart')).toBe('Num 7');
    expect(of('RecenterHeadMountedDisplay')).toBe(';');
    expect(of('DCamFOVInc')).toBe(']');
  });
});

describe('iRacing in RigReady', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  /** The rig with iRacing's files saying the wheel had another Windows id. */
  async function withOldId(): Promise<WiredApp> {
    const rig = await wiredApp('racing-fresh');
    const dir = path.join(rig.ports.folders.documents(), 'iRacing');
    const cfg = replaceGuidBytes(
      new Uint8Array(await fs.readFile(path.join(dir, 'controls.cfg'))),
      DD2,
      OLD
    );
    await fs.writeFile(path.join(dir, 'controls.cfg'), cfg.bytes);
    const yaml = await fs.readFile(path.join(dir, 'joyCalib.yaml'), 'utf8');
    await fs.writeFile(path.join(dir, 'joyCalib.yaml'), replaceGuidText(yaml, DD2, OLD).text);
    return rig;
  }

  it('lists bindings per device in plain language, matched to the connected wheel', async () => {
    app = await wiredApp('racing-fresh');
    const view = await app.invoke<IracingView>('racing:iracing');
    expect(view.installed).toBe(true);
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({
      name: 'FANATEC Podium Wheel Base DD2',
      state: 'connected',
      bindingCount: 17,
      calibrated: true,
    });
    expect(view.devices[0]!.axes.map((a) => a.name)).toEqual([
      'Clutch or combined pedals',
      'Brake',
      'Accelerator',
      'Wheel Axis',
    ]);
    const byAction = new Map(view.bindings.map((b) => [b.action, b]));
    expect(byAction.get('Throttle')).toMatchObject({
      label: 'Throttle',
      input: 'Accelerator',
      deviceName: 'FANATEC Podium Wheel Base DD2',
    });
    // iRacing's clutch is on Y, which the Fanatec driver (and joyCalib.yaml) calls "Combined
    // Pedals" in every pedal mode.
    expect(byAction.get('Clutch')).toMatchObject({ input: 'Clutch or combined pedals' });
    expect(byAction.get('SteerRight')!.input).toBe('Wheel Axis, turning right');
    expect(byAction.get('ShiftUp')!.input).toBe('Button 5');
    expect(byAction.get('Ignition')).toMatchObject({ deviceName: 'Keyboard', input: 'I' });
    expect(view.bindings.length + view.unboundCount).toBe(367);
    expect(view.forceFeedback.find((f) => f.key === 'loadFanatecAPI')?.value).toBe('1');
    expect(view.customCars).toEqual([]);
  });

  it('flags a wheel whose stored id no longer matches and repairs both files through FileStore', async () => {
    app = await withOldId();
    const dir = path.join(app.ports.folders.documents(), 'iRacing');
    const before = await app.invoke<IracingView>('racing:iracing');
    expect(before.devices[0]).toMatchObject({ key: OLD, state: 'moved', suggested: DD2 });
    expect(before.devices[0]!.candidates.map((c) => c.guid)).toEqual([DD2]);

    const check = app.wiring.context.checks.check('racing.iracingDevices')!;
    const failing = await check.run({}, app.ctx);
    expect(failing.pass).toBe(false);
    expect(failing.summary).toContain('iRacing will ask to recalibrate');

    const result = await app.invoke<{ message: string }>('racing:iracingRepair', {
      mapping: [{ from: OLD, to: DD2 }],
    });
    expect(result.message).toContain('Updated 17 bindings');
    // Byte for byte the recorded files again.
    expect(
      Buffer.from(await fs.readFile(path.join(dir, 'controls.cfg'))).equals(
        await fs.readFile(path.join(recorded, 'controls.cfg'))
      )
    ).toBe(true);
    expect(await fs.readFile(path.join(dir, 'joyCalib.yaml'), 'utf8')).toBe(
      await fs.readFile(path.join(recorded, 'joyCalib.yaml'), 'utf8')
    );
    const after = await app.invoke<IracingView>('racing:iracing');
    expect(after.devices[0]!.state).toBe('connected');
    expect((await check.run({}, app.ctx)).pass).toBe(true);

    // One journaled action with both files, which Undo puts back.
    const groups = await app.ports.files.journalGroups();
    if (!groups.ok) throw new Error('journal');
    const group = groups.value[0]!;
    expect(group.reason).toBe(
      'Point iRacing at the new Windows id of FANATEC Podium Wheel Base DD2'
    );
    expect(group.entries.map((e) => path.basename(e.path)).sort()).toEqual([
      'controls.cfg',
      'joyCalib.yaml',
    ]);
    expect((await app.ports.files.undoGroup(group.id)).ok).toBe(true);
    expect((await app.invoke<IracingView>('racing:iracing')).devices[0]!.state).toBe('moved');
  });

  it('also updates a car with custom controls, and lists the per-car sets', async () => {
    app = await withOldId();
    const dir = path.join(app.ports.folders.documents(), 'iRacing');
    const car = path.join(dir, 'setups', 'mx5 mx52016');
    await fs.mkdir(car, { recursive: true });
    await fs.copyFile(path.join(dir, 'controls.cfg'), path.join(car, 'controls.cfg'));
    await fs.copyFile(path.join(dir, 'joyCalib.yaml'), path.join(car, 'joyCalib.yaml'));
    expect((await app.invoke<IracingView>('racing:iracing')).customCars).toEqual(['mx5 mx52016']);
    await app.invoke('racing:iracingRepair', { mapping: [{ from: OLD, to: DD2 }] });
    expect(await fs.readFile(path.join(car, 'joyCalib.yaml'), 'utf8')).toContain(DD2);
    expect(
      Buffer.from(await fs.readFile(path.join(car, 'controls.cfg'))).equals(
        await fs.readFile(path.join(recorded, 'controls.cfg'))
      )
    ).toBe(true);
  });

  it('refuses to repair while the simulator runs, and refuses a controller that is not a candidate', async () => {
    app = await withOldId();
    await expect(
      app.invoke('racing:iracingRepair', {
        mapping: [{ from: OLD, to: '0F1424B4-D566-14A0-801B-444553540000' }],
      })
    ).rejects.toThrow('not a connected');
    await expect(
      app.invoke('racing:iracingRepair', { mapping: [{ from: DD2, to: DD2 }] })
    ).rejects.toThrow('no controller');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\Program Files (x86)\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    expect((await app.invoke<IracingView>('racing:iracing')).simRunning).toBe(true);
    await expect(
      app.invoke('racing:iracingRepair', { mapping: [{ from: OLD, to: DD2 }] })
    ).rejects.toThrow('Close iRacing first');
  });

  it('says a controller is not connected when no controller of that model is attached', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    const view = await app.invoke<IracingView>('racing:iracing');
    expect(view.devices[0]!.state).toBe('missing');
    const outcome = await app.wiring.context.checks
      .check('racing.iracingDevices')!
      .run({}, app.ctx);
    expect(outcome).toMatchObject({
      pass: false,
      summary: 'Not connected: FANATEC Podium Wheel Base DD2',
    });
  });

  it('only suggests a new id it is sure of', () => {
    const device = (guid: string, numButtons = 108) => ({
      index: 0,
      name: 'FANATEC Podium Wheel Base DD2',
      guid,
      productGuid: DD2_PRODUCT,
      vendorId: '0EB7',
      productId: '0007',
      numAxes: 8,
      numButtons,
      numHats: 1,
      axisNames: [],
    });
    const col1 = device('AAAAAAAA-03A4-11F1-8001-444553540000');
    const col2 = device('AAAAAAAA-03A4-11F1-8002-444553540000', 63);
    expect(suggestTarget(OLD, [col1])).toBe(col1.guid);
    // The base shows up twice: the collection number decides.
    expect(suggestTarget(OLD, [col1, col2])).toBe(col1.guid);
    // Two identical wheels on collection 8001 each: the user chooses.
    expect(
      suggestTarget(OLD, [col1, device('BBBBBBBB-03A4-11F1-8001-444553540000')])
    ).toBeUndefined();
  });
});
