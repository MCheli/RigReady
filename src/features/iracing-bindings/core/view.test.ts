import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { err } from '../../../core/result';
import { iracingBindingsContract, type Action, type Overview, type SetView } from '../contract';
import {
  encodeControlsFile,
  encodeRecordData,
  parseControlsFile,
  type Binding,
} from './controlsFile';
import { controlProfileLines, setView, type BindingsContext } from './view';

const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const WHEEL_PRODUCT = '00070EB7-0000-0000-0000-504944564944';
const BOX = '5EED0001-7A11-11EF-8004-444553540000';
const HANDBRAKE = '5EED0002-7A11-11EF-8005-444553540000';
const CAR = 'car:mx5 mx52016';
const NO_NAMES = { nameOf: () => undefined };
/** A file of this feature's scenario data, for a mutation made while a test runs. */
const DATA = (name: string): string =>
  path.join(fixturesDir, 'scenarios', 'data', 'iracing-bindings', name);

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

/**
 * Of the recorded rig only the iRacing folder is copied: it is all these tests look at, and
 * copying the whole recording for every test takes most of a test’s time on a busy PC.
 */
const RECORDED = ['Documents/iRacing/**'];
const start = async (scenario: string): Promise<WiredApp> =>
  (app = await wiredApp(scenario, { files: RECORDED }));
const overviewOf = (a: WiredApp): Promise<Overview> =>
  a.invoke<Overview>('iracing-bindings:overview');
const setOf = (a: WiredApp, id: string): Promise<SetView> =>
  a.invoke<SetView>('iracing-bindings:set', { id });
const action = (view: SetView, id: string): Action => view.actions.find((a) => a.id === id)!;
const bctx = (a: WiredApp): BindingsContext => ({
  ports: a.ports,
  log: a.ctx.log,
  games: a.wiring.context.games,
});
const iracingDir = (a: WiredApp): string => path.join(a.ports.folders.documents(), 'iRacing');

/** Rewrites records of a controls.cfg in the fake user folder, by action. */
async function rewrite(
  a: WiredApp,
  file: string,
  change: (action: string, flag: number, mask: number) => Uint8Array | undefined
): Promise<void> {
  const parsed = parseControlsFile(new Uint8Array(await fs.readFile(file)));
  if (!parsed.ok) throw new Error(parsed.error.message);
  for (const record of parsed.value.records) {
    record.data = change(record.action, record.flag, record.mask) ?? record.data;
  }
  await fs.writeFile(file, encodeControlsFile(parsed.value));
}

describe('iRacing bindings: where they are', () => {
  it('finds the set for all cars on the racing rig, and no car with custom controls', async () => {
    const a = await start('racing-fresh');
    const view = await overviewOf(a);
    expect(view.folder).toBe(iracingDir(a));
    expect(view.simRunning).toBe(false);
    expect(view.sets).toEqual([
      {
        id: 'all',
        name: 'All cars',
        general: true,
        file: path.join(iracingDir(a), 'controls.cfg'),
      },
    ]);
    expect(view.carFolders).toBe(0);
    // The recorded iRacing is the build of April 2026, from before control profiles.
    expect(view.source).toEqual({ kind: 'files', oldFiles: [] });
    // The page that repairs a controller id is the one the app's iRacing reader names.
    expect(view.repairRoute).toBe(a.wiring.context.bindings.get('iracing')?.route());
    expect(view.repairRoute).toMatch(/^\/configure\//);
  });

  it('lists a car only when it has a controls.cfg of its own', async () => {
    const a = await start('iracing-bindings-car');
    const view = await overviewOf(a);
    expect(view.sets.map((s) => [s.id, s.name, s.general])).toEqual([
      ['all', 'All cars', true],
      [CAR, 'mx5 mx52016', false],
    ]);
    // Two cars were driven; one of them has custom controls.
    expect(view.carFolders).toBe(2);
    expect(view.sets[1]!.file).toBe(
      path.join(iracingDir(a), 'setups', 'mx5 mx52016', 'controls.cfg')
    );
  });

  it('says so when iRacing was never set up on this PC', async () => {
    const a = await start('generic-fresh');
    const view = await overviewOf(a);
    expect(view).toMatchObject({ installed: false, simRunning: false, sets: [], carFolders: 0 });
    expect(view.folder).toBeUndefined();
    const result = await setView(bctx(a), 'all', NO_NAMES);
    expect(!result.ok && result.error).toMatchObject({
      code: 'iracing-bindings.notFound',
      message: 'The iRacing folder in Documents was not found.',
    });
  });

  it('has no sets while iRacing has not written a controls.cfg yet', async () => {
    const a = await start('racing-fresh');
    await mutate(a, [{ op: 'removeFile', path: 'Documents/iRacing/controls.cfg' }]);
    const view = await overviewOf(a);
    expect(view.folder).toBe(iracingDir(a));
    expect(view.sets).toEqual([]);
    const result = await setView(bctx(a), 'all', NO_NAMES);
    expect(!result.ok && result.error.message).toBe(
      'iRacing has no controls.cfg yet. Bind something in iRacing first; this page then fills in.'
    );
  });

  it('knows the simulator from the launcher: only the simulator writes these files', async () => {
    const a = await start('racing-fresh');
    await mutate(a, [
      { op: 'startProcess', name: 'iRacingUI.exe', path: 'C:\\iRacing\\ui\\iRacingUI.exe' },
    ]);
    expect((await overviewOf(a)).simRunning).toBe(false);
    await mutate(a, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    expect((await overviewOf(a)).simRunning).toBe(true);
  });
});

describe('iRacing bindings: control profiles (iRacing 2026 Season 3 and later)', () => {
  const PROFILE = 'iracing-bindings-profiles';
  const profileFile = (a: WiredApp, name = 'Baseline'): string =>
    path.join(iracingDir(a), 'profiles', 'controls', name, 'controls.cfg');
  const setIni = (lines: string): ReturnType<typeof mutate> =>
    mutate(app!, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/app.ini',
        content: `[Audio]\r\nvolume=1\r\n\r\n${lines}\r\n[Drive Screen]\r\nblackBox=2\r\n`,
      },
    ]);

  it('reads the profile app.ini names for all cars, not the older controls.cfg', async () => {
    const a = await start(PROFILE);
    const view = await overviewOf(a);
    expect(view.sets).toEqual([
      {
        id: 'all',
        name: 'All cars',
        general: true,
        file: profileFile(a),
        profile: 'Baseline',
      },
    ]);
    expect(view.source).toEqual({
      kind: 'profiles',
      profile: 'Baseline',
      oldFiles: [path.join(iracingDir(a), 'controls.cfg')],
    });
    const set = await setOf(a, 'all');
    expect(set.set.file).toBe(profileFile(a));
    // The two actions the profile has and the older file does not, unbound as iRacing made them.
    expect(set.counts).toEqual({ actions: 369, bound: 183, unbound: 186, unread: 0, differs: 0 });
    expect(action(set, 'PitSummaryToggle')).toMatchObject({ accepts: ['button', 'key'] });
    expect(action(set, 'PitSummaryToggle').binding).toBeUndefined();
    expect(action(set, 'ToggleUIVisibleDrive').binding).toBeUndefined();
    expect(action(set, 'Throttle').binding?.input).toBe('Accelerator');
    expect(set.notes).toEqual([]);
  });

  it('shows what the profile has when the older file says something else', async () => {
    const a = await start(PROFILE);
    // A binding only in the older file is not one iRacing uses, so it is not shown.
    await rewrite(a, path.join(iracingDir(a), 'controls.cfg'), (id, flag, mask) =>
      id === 'HeadlightFlash'
        ? encodeRecordData(flag, mask, { kind: 'key', keyCode: 72, modifiers: 0 })
        : undefined
    );
    expect(action(await setOf(a, 'all'), 'HeadlightFlash').binding).toBeUndefined();
    // A binding made in iRacing lands in the profile, and shows.
    await rewrite(a, profileFile(a), (id, flag, mask) =>
      id === 'PitSummaryToggle'
        ? encodeRecordData(flag, mask, { kind: 'key', keyCode: 75, modifiers: 0x03 })
        : undefined
    );
    expect(action(await setOf(a, 'all'), 'PitSummaryToggle').binding?.input).toBe('Shift+K');
  });

  it('names the wheel and its axes from the calibration file of the profile', async () => {
    const a = await start(PROFILE);
    await mutate(a, [{ op: 'removeFile', path: 'Documents/iRacing/joyCalib.yaml' }]);
    const set = await setOf(a, 'all');
    expect(action(set, 'Throttle').binding?.input).toBe('Accelerator');
    expect(set.notes).toEqual([]);
  });

  it('reads the profile app.ini names, whatever its name', async () => {
    const a = await start(PROFILE);
    await mutate(a, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/Wheel only/controls.cfg',
        from: DATA('profile-controls.cfg'),
      },
    ]);
    await setIni('[ControlProfiles]\r\nglobal=Wheel only\r\n');
    const view = await overviewOf(a);
    expect(view.sets.map((s) => [s.id, s.profile, s.file])).toEqual([
      ['all', 'Wheel only', profileFile(a, 'Wheel only')],
    ]);
    expect(view.source.profile).toBe('Wheel only');
  });

  it('says it cannot tell which bindings iRacing uses when app.ini names no profile', async () => {
    const a = await start(PROFILE);
    await setIni('');
    const view = await overviewOf(a);
    expect(view.sets).toEqual([]);
    const problem =
      'iRacing keeps control profiles, but app.ini names none for all cars, so RigReady cannot tell which bindings iRacing uses.';
    expect(view.source).toEqual({
      kind: 'profiles',
      problem,
      oldFiles: [path.join(iracingDir(a), 'controls.cfg')],
    });
    // Never the older file in its place: iRacing does not read it.
    const result = await setView(bctx(a), 'all', NO_NAMES);
    expect(!result.ok && result.error).toMatchObject({
      code: 'iracing-bindings.noSet',
      message: problem,
    });
  });

  it('says so when the profile app.ini names has no controls.cfg', async () => {
    const a = await start(PROFILE);
    await setIni('[ControlProfiles]\r\nGlobal=Gone\r\n');
    const view = await overviewOf(a);
    expect(view.sets).toEqual([]);
    expect(view.source.problem).toBe(
      'iRacing uses the control profile “Gone” for all cars, but RigReady found no controls.cfg in it.'
    );
  });

  it('never turns a profile name into a path outside the profiles folder', async () => {
    const a = await start(PROFILE);
    for (const name of ['..\\..', '../Baseline', 'C:\\Windows', '..', 'Base\\line', 'Baseline.']) {
      await setIni(`[ControlProfiles]\r\nGlobal=${name}\r\n`);
      const view = await overviewOf(a);
      expect(view.sets, name).toEqual([]);
      expect(view.source.problem, name).toMatch(/found no controls\.cfg in it\.$/);
    }
  });

  it('reads a car’s own profile when app.ini names one for its folder', async () => {
    const a = await start(PROFILE);
    await mutate(a, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/mx5 mx52016/controls.cfg',
        from: DATA('controls-car.cfg'),
      },
      // The car's file from before control profiles: iRacing no longer reads it.
      {
        op: 'writeFile',
        path: 'Documents/iRacing/setups/mx5 mx52016/controls.cfg',
        from: DATA('controls-car.cfg'),
      },
      // A line for a car that was never driven here is not a set.
      { op: 'writeFile', path: 'Documents/iRacing/setups/ferrari296gt3/x.sto', content: 'x' },
    ]);
    await setIni(
      '[ControlProfiles]\r\nGlobal=Baseline\r\nmx5 mx52016=mx5 mx52016\r\nporsche992rgt3=Baseline\r\n'
    );
    const view = await overviewOf(a);
    expect(view.sets.map((s) => [s.id, s.profile])).toEqual([
      ['all', 'Baseline'],
      [CAR, 'mx5 mx52016'],
    ]);
    expect(view.sets[1]!.file).toBe(profileFile(a, 'mx5 mx52016'));
    expect(view.source.oldFiles).toEqual([
      path.join(iracingDir(a), 'controls.cfg'),
      path.join(iracingDir(a), 'setups', 'mx5 mx52016', 'controls.cfg'),
    ]);
    // Compared with the profile for all cars: the eight records the car file changes.
    const car = await setOf(a, CAR);
    expect(car.counts.differs).toBe(8);
  });

  it('reads app.ini’s section whatever its case, and skips comments and padding', () => {
    expect(
      controlProfileLines(
        '[Audio]\nGlobal=Wrong\n[controlprofiles]\n; a comment\nGlobal = Baseline    \t; for all cars\nmx5 mx52016=Mine\n[Next]\nGlobal=Other\n'
      )
    ).toEqual([
      { key: 'Global', value: 'Baseline' },
      { key: 'mx5 mx52016', value: 'Mine' },
    ]);
  });

  it('leaves every file of the iRacing folder as it was', async () => {
    const a = await start(PROFILE);
    const before = await filesOf(iracingDir(a));
    expect(Object.keys(before)).toContain(
      path.join('profiles', 'controls', 'Baseline', 'controls.cfg')
    );
    await overviewOf(a);
    await setOf(a, 'all');
    expect(await filesOf(iracingDir(a))).toEqual(before);
  });
});

describe('iRacing bindings: the set for all cars', () => {
  it('lists every action, bound or not, with the device and input in plain words', async () => {
    const a = await start('racing-fresh');
    const view = await setOf(a, 'all');
    expect(view.set.id).toBe('all');
    expect(view.counts).toEqual({ actions: 367, bound: 183, unbound: 184, unread: 0, differs: 0 });
    expect(view.actions).toHaveLength(367);
    expect(view.notes).toEqual([]);

    expect(action(view, 'Throttle')).toEqual({
      id: 'Throttle',
      name: 'Throttle',
      group: 'Driving',
      accepts: ['axis', 'button', 'key'],
      binding: {
        kind: 'axis',
        device: WHEEL,
        deviceName: 'FANATEC Podium Wheel Base DD2',
        // The name iRacing's calibration file has for axis 2 of the wheel base.
        input: 'Accelerator',
      },
      differs: false,
    });
    expect(action(view, 'SteerLeft').binding?.input).toBe('Wheel Axis, turning left');
    expect(action(view, 'SteerRight').binding?.input).toBe('Wheel Axis, turning right');
    expect(action(view, 'ShiftUp').binding).toMatchObject({ kind: 'button', input: 'Button 5' });
    expect(action(view, 'Reset').binding?.input).toBe('Button 26');
    expect(action(view, 'Ignition').binding).toEqual({
      kind: 'key',
      device: 'keyboard',
      deviceName: 'Keyboard',
      input: 'I',
    });
    expect(action(view, 'ReloadCarTexture').binding?.input).toBe('Ctrl+R');
    // Not bound: the action is still listed, with what it could be bound to.
    const handbrake = action(view, 'Handbrake');
    expect(handbrake.binding).toBeUndefined();
    expect(handbrake.accepts).toEqual(['axis', 'button', 'key']);
    expect(action(view, 'BrakeBiasLevel')).toMatchObject({
      name: 'Brake bias (axis)',
      group: 'In-car adjustments',
      accepts: ['axis'],
    });
  });

  it('lists the devices the set names, matched to what is plugged in', async () => {
    const a = await start('racing-fresh');
    const view = await setOf(a, 'all');
    expect(view.devices).toEqual([
      {
        key: WHEEL,
        kind: 'controller',
        name: 'FANATEC Podium Wheel Base DD2',
        vendorId: '0EB7',
        productId: '0007',
        state: 'connected',
        bound: 17,
      },
      { key: 'keyboard', kind: 'keyboard', name: 'Keyboard', state: 'connected', bound: 166 },
    ]);
  });

  it('uses the name the owner gave a controller', async () => {
    const a = await start('racing-fresh');
    const asked: unknown[] = [];
    const result = await setView(bctx(a), 'all', {
      nameOf: (device) => {
        asked.push(device);
        return 'Race wheel';
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(asked).toEqual([{ vendorId: '0EB7', productId: '0007', guid: WHEEL }]);
    expect(result.value.devices[0]).toMatchObject({
      name: 'FANATEC Podium Wheel Base DD2',
      givenName: 'Race wheel',
    });
    expect(action(result.value, 'Throttle').binding?.deviceName).toBe('Race wheel');
  });

  it('lists the inputs that do more than one thing, the camera editor ones apart', async () => {
    const a = await start('racing-fresh');
    const view = await setOf(a, 'all');
    expect(view.shared).toHaveLength(10);
    // iRacing's own default keys: Space does two things outside the camera editor.
    expect(view.shared[0]).toEqual({
      device: 'keyboard',
      deviceName: 'Keyboard',
      input: 'Space',
      actions: [
        { id: 'BlackBoxToggle', name: 'Black box toggle control', group: 'Interface and chat' },
        { id: 'ToggleUIVisible', name: 'Hide or show the UI', group: 'Interface and chat' },
      ],
      cameraEditor: false,
    });
    // The other nine pair a driving key with a camera editor key, as iRacing ships them.
    const camera = view.shared.slice(1);
    expect(camera.every((s) => s.cameraEditor)).toBe(true);
    expect(camera.find((s) => s.input === 'A')?.actions.map((x) => x.id)).toEqual([
      'PitSpeedLimiter',
      'CamLatInc',
    ]);
  });

  it('says whether a controller is plugged in, has a new Windows id, or is missing', async () => {
    const a = await start('racing-fresh');
    await mutate(a, [
      {
        op: 'setController',
        match: { vendorId: '0EB7' },
        set: { guid: '99998888-7777-11F1-8001-444553540000' },
      },
    ]);
    expect((await setOf(a, 'all')).devices[0]).toMatchObject({ key: WHEEL, state: 'moved' });
    await mutate(a, [{ op: 'unplugDevice', match: { vendorId: '0EB7' } }]);
    expect((await setOf(a, 'all')).devices[0]).toMatchObject({ key: WHEEL, state: 'missing' });
  });

  it('says it cannot tell when Windows does not list the controllers', async () => {
    const a = await start('racing-fresh');
    const ctx = bctx(a);
    const result = await setView(
      {
        ...ctx,
        ports: {
          ...ctx.ports,
          input: { ...ctx.ports.input, start: async () => err('input.read', 'No DirectInput.') },
        },
      },
      'all',
      NO_NAMES
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.devices[0]).toMatchObject({
      key: WHEEL,
      name: 'FANATEC Podium Wheel Base DD2',
      state: 'unknown',
    });
  });

  it('shows axes by number when the calibration file cannot be read, and says why', async () => {
    const a = await start('racing-fresh');
    await mutate(a, [
      { op: 'writeFile', path: 'Documents/iRacing/joyCalib.yaml', content: 'nothing useful' },
    ]);
    const view = await setOf(a, 'all');
    expect(action(view, 'Throttle').binding).toMatchObject({
      // Without the calibration file the name comes from the plugged-in controller.
      deviceName: 'FANATEC Podium Wheel Base DD2',
      input: 'Axis 2',
    });
    expect(view.notes).toEqual([
      'iRacing\u2019s calibration file (joyCalib.yaml) could not be read, so some axes are shown by number.',
    ]);
    // No file at all is not worth a note: iRacing writes it at the first calibration.
    await mutate(a, [{ op: 'removeFile', path: 'Documents/iRacing/joyCalib.yaml' }]);
    expect((await setOf(a, 'all')).notes).toEqual([]);
  });

  it('refuses a damaged file with a plain message', async () => {
    const a = await start('racing-fresh');
    await mutate(a, [
      { op: 'writeFile', path: 'Documents/iRacing/controls.cfg', content: 'GFCC but nothing else' },
    ]);
    await expect(setOf(a, 'all')).rejects.toThrow(
      'This is not an iRacing bindings file RigReady can read, or it is damaged.'
    );
  });
});

describe('iRacing bindings: a car with custom controls', () => {
  it('shows the car’s own bindings and where they differ from all cars', async () => {
    const a = await start('iracing-bindings-car');
    const view = await setOf(a, CAR);
    expect(view.set).toMatchObject({ id: CAR, name: 'mx5 mx52016', general: false });
    expect(view.counts).toEqual({ actions: 367, bound: 186, unbound: 181, unread: 0, differs: 8 });
    expect(view.actions.filter((x) => x.differs).map((x) => x.id)).toEqual([
      'PitSpeedLimiter',
      'Handbrake',
      'LookLeft',
      'BrakeBiasInc',
      'BrakeBiasDec',
      'TractionControlInc',
      'TractionControlDec',
      'HeadlightFlash',
    ]);
    expect(action(view, 'BrakeBiasInc')).toMatchObject({
      binding: { kind: 'button', device: BOX, deviceName: 'Button Box', input: 'Button 1' },
      differs: true,
      general: 'Keyboard: =',
    });
    expect(action(view, 'LookLeft')).toMatchObject({
      differs: true,
      general: 'FANATEC Podium Wheel Base DD2: Button 4',
    });
    expect(action(view, 'LookLeft').binding).toBeUndefined();
    expect(action(view, 'Handbrake')).toMatchObject({
      // Named by the calibration file in the car's own folder.
      binding: { kind: 'axis', device: HANDBRAKE, deviceName: 'USB Handbrake', input: 'Handbrake' },
      general: 'Not bound',
    });
    // An action the car leaves as it is carries no "all cars" value.
    expect(action(view, 'Throttle')).toMatchObject({ differs: false });
    expect(action(view, 'Throttle').general).toBeUndefined();
  });

  it('lists the car’s devices: the button box plugged in, the handbrake not', async () => {
    const a = await start('iracing-bindings-car');
    const view = await setOf(a, CAR);
    expect(view.devices.map((d) => [d.name, d.state, d.bound])).toEqual([
      ['Button Box', 'connected', 4],
      ['FANATEC Podium Wheel Base DD2', 'connected', 18],
      ['USB Handbrake', 'missing', 1],
      ['Keyboard', 'connected', 163],
    ]);
    expect(view.devices[0]).toMatchObject({ key: BOX, vendorId: '1209', productId: '0001' });
  });

  it('puts the wheel button that does two things first among the shared inputs', async () => {
    const a = await start('iracing-bindings-car');
    const view = await setOf(a, CAR);
    expect(view.shared[0]).toEqual({
      device: WHEEL,
      deviceName: 'FANATEC Podium Wheel Base DD2',
      input: 'Button 7',
      actions: [
        { id: 'PitSpeedLimiter', name: 'Pit speed limiter', group: 'Driving' },
        { id: 'HeadlightFlash', name: 'Flash headlights', group: 'Driving' },
      ],
      cameraEditor: false,
    });
    expect(view.shared.filter((s) => !s.cameraEditor)).toHaveLength(2);
    expect(view.shared.filter((s) => s.cameraEditor)).toHaveLength(6);
  });

  it('names a controller by its USB ids when nothing else knows it', async () => {
    const a = await start('iracing-bindings-car');
    await mutate(a, [
      { op: 'removeFile', path: 'Documents/iRacing/setups/mx5 mx52016/joyCalib.yaml' },
    ]);
    const view = await setOf(a, CAR);
    expect(action(view, 'Handbrake').binding).toMatchObject({
      deviceName: 'Controller 1209:0002',
      input: 'Axis 0',
    });
    // The wheel is still named by the calibration file for all cars.
    expect(action(view, 'Throttle').binding?.input).toBe('Accelerator');
  });

  it('still shows the car when the set for all cars cannot be read, and says what is missing', async () => {
    const a = await start('iracing-bindings-car');
    await mutate(a, [
      { op: 'writeFile', path: 'Documents/iRacing/controls.cfg', content: 'damaged' },
    ]);
    const view = await setOf(a, CAR);
    expect(view.counts).toMatchObject({ actions: 367, bound: 186, differs: 0 });
    expect(view.notes).toEqual([
      'The bindings for all cars could not be read, so this page cannot say where this car differs.',
    ]);
  });

  it('never turns a set id into a path', async () => {
    const a = await start('iracing-bindings-car');
    for (const id of ['car:..', 'car:../..', 'car:ferrari296gt3', 'C:\\Windows\\win.ini', '']) {
      const result = await setView(bctx(a), id, NO_NAMES);
      expect(!result.ok && result.error, id).toMatchObject({
        code: 'iracing-bindings.noSet',
        message: 'iRacing has no custom controls for that car.',
      });
    }
  });
});

describe('iRacing bindings: what RigReady cannot read is said, not guessed', () => {
  const put =
    (changes: Record<string, Binding>) =>
    (id: string, flag: number, mask: number): Uint8Array | undefined =>
      changes[id] ? encodeRecordData(flag, mask, changes[id]) : undefined;

  it('counts a binding of an unknown kind and shows it as one it cannot read', async () => {
    const a = await start('racing-fresh');
    const file = path.join(iracingDir(a), 'controls.cfg');
    await rewrite(
      a,
      file,
      put({
        Handbrake: { kind: 'unknown', type: 8 },
        // A button binding that names no button.
        DRS: { kind: 'button', buttons: [], instanceGuid: WHEEL, productGuid: WHEEL_PRODUCT },
      })
    );
    const view = await setOf(a, 'all');
    expect(view.counts).toMatchObject({ bound: 185, unread: 2 });
    for (const id of ['Handbrake', 'DRS']) {
      expect(action(view, id).binding).toEqual({
        kind: 'unknown',
        device: '',
        deviceName: '',
        input: 'A binding RigReady cannot read',
      });
    }
    // Neither counts for a device, and two unread bindings are not "the same input".
    expect(view.devices[0]!.bound).toBe(17);
    expect(view.shared).toHaveLength(10);
  });

  it('shows what it has not seen before as it stands', async () => {
    const a = await start('racing-fresh');
    const file = path.join(iracingDir(a), 'controls.cfg');
    await rewrite(
      a,
      file,
      put({
        Handbrake: {
          kind: 'axis',
          axis: 1,
          instanceGuid: WHEEL,
          productGuid: WHEEL_PRODUCT,
          direction: 1,
        },
        DRS: { kind: 'button', buttons: [4, 5], instanceGuid: WHEEL, productGuid: WHEEL_PRODUCT },
        // Not a USB device id: nothing to match it to.
        PushToPass: {
          kind: 'button',
          buttons: [0],
          instanceGuid: '6F1D2B61-D5A0-11CF-BFC7-444553540000',
          productGuid: '6F1D2B60-D5A0-11CF-BFC7-444553540000',
        },
      })
    );
    const view = await setOf(a, 'all');
    expect(action(view, 'Handbrake').binding?.input).toBe('Brake (direction 1)');
    expect(action(view, 'DRS').binding?.input).toBe('Buttons 5 and 6');
    expect(action(view, 'PushToPass').binding).toMatchObject({
      deviceName: 'Unknown controller',
      input: 'Button 1',
    });
    expect(view.devices.find((d) => d.name === 'Unknown controller')).toMatchObject({
      state: 'missing',
      bound: 1,
    });
    expect(view.devices.find((d) => d.name === 'Unknown controller')?.vendorId).toBeUndefined();
  });
});

/** Every file under a folder, with its bytes, so two moments can be compared. */
async function filesOf(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(folder, full)] = (await fs.readFile(full)).toString('base64');
    }
  };
  await walk(folder);
  return out;
}

describe('iRacing bindings: reading only', () => {
  it('leaves every file of the iRacing folder as it was, byte for byte', async () => {
    const a = await start('iracing-bindings-car');
    const before = await filesOf(iracingDir(a));
    expect(Object.keys(before)).toContain('controls.cfg');
    expect(Object.keys(before)).toContain(path.join('setups', 'mx5 mx52016', 'controls.cfg'));
    await overviewOf(a);
    await setOf(a, 'all');
    await setOf(a, CAR);
    expect(await filesOf(iracingDir(a))).toEqual(before);
  });

  it('has two channels that read; the ones that change are kept from a local AI', () => {
    const channels = Object.entries(iracingBindingsContract.channels).map(([name, def]) => [
      name,
      def.meta?.tier,
    ]);
    // "off" keeps a channel out of the tools a local AI is given. Changing a binding stays
    // there until iRacing has taken a file RigReady changed (change.test.ts has the switch).
    expect(channels).toEqual([
      ['overview', 'read'],
      ['set', 'read'],
      ['changePreview', 'off'],
      ['change', 'off'],
      ['listenStart', 'off'],
      ['listenStop', 'off'],
    ]);
  });
});
