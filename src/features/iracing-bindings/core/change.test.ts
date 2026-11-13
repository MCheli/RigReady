import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Envelope } from '../../../shared/ipc';
import type { InputDevice, InputState } from '../../../shared/models';
import type {
  ChangeRequest,
  ChangeResult,
  ChangeReview,
  Overview,
  SetView,
  WantedBinding,
} from '../contract';
import { pressedOf } from './change';
import { RECORD_BYTES, parseControlsFile } from './controlsFile';
import { KEPT_BYTES } from './edit';

const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const BOX = '5EED0001-7A11-11EF-8004-444553540000';
const HANDBRAKE = '5EED0002-7A11-11EF-8005-444553540000';
const CAR = 'car:mx5 mx52016';
/** The switch changing bindings was behind until 13 Nov 2026. It does nothing now. */
const OLD_SWITCH = 'RIGREADY_IRACING_EDIT';
const CLOSE_FIRST =
  'Close iRacing first. iRacing writes its bindings when it closes and would undo the change.';
const SIMULATOR = {
  op: 'startProcess',
  name: 'iRacingSim64DX11.exe',
  path: 'C:\\iRacing\\iRacingSim64DX11.exe',
};

let app: WiredApp | undefined;
let switchBefore: string | undefined;
beforeEach(() => {
  // As RigReady ships: nothing in its environment about iRacing bindings.
  switchBefore = process.env[OLD_SWITCH];
  delete process.env[OLD_SWITCH];
});
afterEach(async () => {
  if (switchBefore === undefined) delete process.env[OLD_SWITCH];
  else process.env[OLD_SWITCH] = switchBefore;
  await app?.cleanup();
  app = undefined;
});

/** The racing rig with a car that has custom controls and a button box plugged in. */
async function start(): Promise<WiredApp> {
  return (app = await wiredApp('iracing-bindings-car', { files: ['Documents/iRacing/**'] }));
}
/** A channel as the page calls it, answer and all. */
const call = (a: WiredApp, channel: string, input?: unknown): Promise<Envelope> =>
  a.wiring.handlers.get(`iracing-bindings:${channel}`)!(input);
const refused = async (a: WiredApp, channel: string, input?: unknown): Promise<string> => {
  const answer = await call(a, channel, input);
  return answer.ok ? 'ok' : answer.error.code;
};
const review = (a: WiredApp, request: ChangeRequest): Promise<ChangeReview> =>
  a.invoke<ChangeReview>('iracing-bindings:changePreview', request);
const change = (a: WiredApp, request: ChangeRequest): Promise<ChangeResult> =>
  a.invoke<ChangeResult>('iracing-bindings:change', request);
const setOf = (a: WiredApp, id: string): Promise<SetView> =>
  a.invoke<SetView>('iracing-bindings:set', { id });
const bindingOf = async (a: WiredApp, set: string, action: string) =>
  (await setOf(a, set)).actions.find((x) => x.id === action)!.binding;

const iracingDir = (a: WiredApp): string => path.join(a.ports.folders.documents(), 'iRacing');
const allCars = (a: WiredApp): string => path.join(iracingDir(a), 'controls.cfg');
const carFile = (a: WiredApp): string =>
  path.join(iracingDir(a), 'setups', 'mx5 mx52016', 'controls.cfg');
const bytesOf = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(file));
const equal = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
async function journal(a: WiredApp) {
  const entries = await a.ports.files.journal();
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value;
}
/** The bytes of a file that differ from an earlier copy, as offsets into one record. */
function changedIn(before: Uint8Array, after: Uint8Array, action: string): number[] {
  expect(after.length).toBe(before.length);
  const parsed = parseControlsFile(before);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const record = parsed.value.records.find((r) => r.action === action)!;
  const at: number[] = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) at.push(i - record.offset);
  return at;
}
function expectOnlyThatRecord(before: Uint8Array, after: Uint8Array, action: string): void {
  const at = changedIn(before, after, action);
  expect(at.length).toBeGreaterThan(0);
  for (const offset of at) {
    expect(offset).toBeGreaterThanOrEqual(KEPT_BYTES);
    expect(offset).toBeLessThan(RECORD_BYTES);
  }
}

const boxButton = (button: number): WantedBinding => ({ kind: 'button', device: BOX, button });
const key = (keyCode: number, modifiers = 0): WantedBinding => ({
  kind: 'key',
  keyCode,
  modifiers,
});
const FLASH_ON_7: ChangeRequest = { set: 'all', action: 'HeadlightFlash', binding: boxButton(7) };

describe('changing an iRacing binding: on as RigReady ships', () => {
  it('needs no switch: with nothing in the environment every channel of it answers', async () => {
    const a = await start();
    expect(process.env[OLD_SWITCH]).toBeUndefined();
    const general = await bytesOf(allCars(a));
    // The overview no longer says whether changing is on: it always is.
    expect(Object.keys(await a.invoke<Overview>('iracing-bindings:overview'))).not.toContain(
      'editing'
    );
    expect(await call(a, 'changePreview', FLASH_ON_7)).toMatchObject({ ok: true });
    expect(await call(a, 'listenStart')).toEqual({ ok: true, value: { listening: true } });
    expect(await call(a, 'listenStop')).toEqual({ ok: true, value: { listening: false } });
    // Neither the review nor listening writes anything: only `change` does.
    expect(equal(await bytesOf(allCars(a)), general)).toBe(true);
    expect(await journal(a)).toEqual([]);
    expect(await call(a, 'change', FLASH_ON_7)).toMatchObject({ ok: true });
    expect(await journal(a)).toHaveLength(1);
  });

  it('turns nothing off when the old switch is set to anything', async () => {
    for (const value of ['0', '', 'off']) {
      process.env[OLD_SWITCH] = value;
      const a = await start();
      expect(await call(a, 'changePreview', FLASH_ON_7), value).toMatchObject({ ok: true });
      await a.cleanup();
      app = undefined;
    }
  });
});

/** A controller's state: nothing held, or the given buttons (the first button is 1). */
function stateOf(device: InputDevice, held: number[] = [], patch: Partial<InputState> = {}) {
  return {
    index: device.index,
    name: device.name,
    axes: Array.from({ length: device.numAxes }, () => 0),
    buttons: Array.from({ length: device.numButtons }, (_, i) => held.includes(i + 1)),
    hats: Array.from({ length: device.numHats }, () => [0, 0] as [number, number]),
    timestamp: 0,
    ...patch,
  } satisfies InputState;
}

describe('changing an iRacing binding: what the user is shown first', () => {
  it('says what the action has now and would have, and writes nothing', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));

    const shown = await review(a, FLASH_ON_7);
    expect(shown).toMatchObject({
      set: { id: 'all', name: 'All cars', general: true, file: allCars(a) },
      action: { id: 'HeadlightFlash', name: 'Flash headlights' },
      before: 'Not bound',
      after: 'Button 7 on Button Box',
      same: false,
      conflicts: [],
    });
    expect(shown.blocked).toBeUndefined();
    // The file, as the shared "this is what will change" list shows it.
    expect(shown.preview.files).toEqual([
      {
        path: allCars(a),
        label: 'controls.cfg',
        change: 'modified',
        detail: expect.any(String),
      },
    ]);
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('names what the same key or button already does in that set', async () => {
    const a = await start();
    // S is the starter, and moves the camera in iRacing's camera editor.
    const s = await review(a, { set: 'all', action: 'HeadlightFlash', binding: key(83) });
    expect(s.after).toBe('S on the keyboard');
    expect(s.conflicts).toEqual([
      { id: 'Starter', name: 'Starter', group: 'Driving', cameraEditor: false },
      {
        id: 'CamLongDec',
        name: 'Camera longitude down',
        group: 'Cameras and replay',
        cameraEditor: true,
      },
    ]);
    // A is the pit speed limiter, and another control of the camera editor.
    const pit = await review(a, { set: 'all', action: 'HeadlightFlash', binding: key(65) });
    expect(pit.conflicts.map((c) => [c.id, c.cameraEditor])).toEqual([
      ['PitSpeedLimiter', false],
      ['CamLatInc', true],
    ]);
    // The same key with Shift is another input: nothing shares it.
    const shifted = await review(a, {
      set: 'all',
      action: 'HeadlightFlash',
      binding: key(83, 0x03),
    });
    expect(shifted.after).toBe('Shift+S on the keyboard');
    expect(shifted.conflicts).toEqual([]);
    // A button of the wheel that is first gear.
    const gear = await review(a, {
      set: 'all',
      action: 'HeadlightFlash',
      binding: { kind: 'button', device: WHEEL, button: 14 },
    });
    expect(gear.after).toBe('Button 14 on FANATEC Podium Wheel Base DD2');
    expect(gear.conflicts.map((c) => c.id)).toEqual(['Gear1']);
    // In the car's set the same button is free or taken as that set has it.
    const car = await review(a, { set: CAR, action: 'Starter', binding: boxButton(7) });
    expect(car.set).toMatchObject({ id: CAR, name: 'mx5 mx52016', general: false });
    expect(car.before).toBe('S on the keyboard');
    expect(await journal(a)).toEqual([]);
  });

  it('says so when saving would change nothing', async () => {
    const a = await start();
    const same = await review(a, { set: 'all', action: 'Starter', binding: key(83) });
    expect(same).toMatchObject({
      before: 'S on the keyboard',
      after: 'S on the keyboard',
      same: true,
    });
    expect(same.preview.files[0]!.change).toBe('unchanged');
    const empty = await review(a, { set: 'all', action: 'HeadlightFlash', binding: null });
    expect(empty).toMatchObject({ before: 'Not bound', after: 'Not bound', same: true });
  });
});

describe('changing an iRacing binding: the write', () => {
  it('binds a button: a backup first, one entry on the Safety page, only that record changed, and Undo puts the file back', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));
    const car = await bytesOf(carFile(a));

    const result = await change(a, FLASH_ON_7);
    expect(result).toEqual({
      changed: true,
      message:
        'Saved in iRacing’s file for all cars: Flash headlights is now bound to Button 7 on Button Box. Undo is on the Safety page.',
      file: allCars(a),
    });

    const after = await bytesOf(allCars(a));
    expectOnlyThatRecord(before, after, 'HeadlightFlash');
    expect(equal(await bytesOf(carFile(a)), car)).toBe(true);
    expect(await bindingOf(a, 'all', 'HeadlightFlash')).toEqual({
      kind: 'button',
      device: BOX,
      deviceName: 'Button Box',
      input: 'Button 7',
    });

    const entries = await journal(a);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({
      path: allCars(a),
      action: 'write',
      reason: 'Change one binding in controls.cfg',
      groupReason:
        'iRacing bindings for all cars: Flash headlights bound to Button 7 on Button Box',
      undone: false,
    });
    // The backup is the file as it was, kept in RigReady's own folder.
    expect(entry.backupPath).toBeTruthy();
    expect(entry.backupPath!.startsWith(a.ports.folders.dataRoot())).toBe(true);
    expect(equal(await bytesOf(entry.backupPath!), before)).toBe(true);

    const undone = await a.ports.files.undoGroup(entry.groupId!);
    expect(undone.ok).toBe(true);
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await bindingOf(a, 'all', 'HeadlightFlash')).toBeUndefined();
  });

  it('writes exactly the file the preview showed', async () => {
    const a = await start();
    const request: ChangeRequest = {
      set: 'all',
      action: 'BlackBoxShowNext',
      binding: key(72, 0x0c),
    };
    const shown = await review(a, request);
    expect(shown.after).toBe('Ctrl+H on the keyboard');
    await change(a, request);
    const entries = await journal(a);
    expect(entries.map((e) => e.path)).toEqual(shown.preview.files.map((f) => f.path));
    // Shown again, the same change is now no change.
    expect((await review(a, request)).same).toBe(true);
  });

  it('writes nothing when the file changed after the preview: what the user approved may not hold', async () => {
    const a = await start();
    const shown = await review(a, FLASH_ON_7);
    expect(shown.seen).toMatch(/^[0-9a-f]{64}$/);
    // Meanwhile something else binds Button 7 of the box in the same file (iRacing, a
    // second window): the preview named no conflict, and now there would be one.
    await change(a, { set: 'all', action: 'BlackBoxShowNext', binding: boxButton(7) });
    const before = await bytesOf(allCars(a));
    const entries = (await journal(a)).length;

    expect(await refused(a, 'change', { ...FLASH_ON_7, seen: shown.seen })).toBe(
      'iracing-bindings.edit.changed'
    );
    const answer = await call(a, 'change', { ...FLASH_ON_7, seen: shown.seen });
    expect(answer.ok ? '' : answer.error.message).toBe(
      'controls.cfg, or which file or cars it is for, changed after the change was shown, so nothing was written. Look at the change again.'
    );
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toHaveLength(entries);

    // Looked at again, the conflict is named, and that preview can be saved.
    const again = await review(a, FLASH_ON_7);
    expect(again.conflicts.map((c) => c.id)).toContain('BlackBoxShowNext');
    expect((await change(a, { ...FLASH_ON_7, seen: again.seen })).changed).toBe(true);
  });

  it('binds a key and clears a binding, each as one entry of its own', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));

    const bound = await change(a, { set: 'all', action: 'HeadlightFlash', binding: key(72, 0x30) });
    expect(bound.message).toBe(
      'Saved in iRacing’s file for all cars: Flash headlights is now bound to Alt+H on the keyboard. Undo is on the Safety page.'
    );
    const middle = await bytesOf(allCars(a));
    expectOnlyThatRecord(before, middle, 'HeadlightFlash');

    const cleared = await change(a, { set: 'all', action: 'Starter', binding: null });
    expect(cleared).toEqual({
      changed: true,
      message:
        'Saved in iRacing’s file for all cars: Starter is no longer bound. Undo is on the Safety page.',
      file: allCars(a),
    });
    expectOnlyThatRecord(middle, await bytesOf(allCars(a)), 'Starter');
    expect(await bindingOf(a, 'all', 'Starter')).toBeUndefined();
    expect(await bindingOf(a, 'all', 'HeadlightFlash')).toMatchObject({ input: 'Alt+H' });

    const entries = await journal(a);
    expect(entries.map((e) => e.groupReason).sort()).toEqual([
      'iRacing bindings for all cars: Flash headlights bound to Alt+H on the keyboard',
      'iRacing bindings for all cars: Starter cleared',
    ]);
    expect(new Set(entries.map((e) => e.groupId)).size).toBe(2);

    // Clearing it again and binding the same key again change nothing and write nothing.
    expect(await change(a, { set: 'all', action: 'Starter', binding: null })).toEqual({
      changed: false,
      message: 'Nothing was changed: Starter is not bound.',
      file: allCars(a),
    });
    expect(
      await change(a, { set: 'all', action: 'HeadlightFlash', binding: key(72, 0x30) })
    ).toEqual({
      changed: false,
      message: 'Nothing was changed: Flash headlights is already bound to Alt+H on the keyboard.',
      file: allCars(a),
    });
    expect(await journal(a)).toHaveLength(2);
  });

  it('changes one car’s set in that car’s file and leaves the file for all cars alone', async () => {
    const a = await start();
    const general = await bytesOf(allCars(a));
    const before = await bytesOf(carFile(a));
    // In this car Look left is not bound; for all cars it is on the wheel.
    expect(await bindingOf(a, CAR, 'LookLeft')).toBeUndefined();

    const result = await change(a, { set: CAR, action: 'LookLeft', binding: boxButton(3) });
    expect(result).toEqual({
      changed: true,
      message:
        'Saved in iRacing’s file for mx5 mx52016: Look left is now bound to Button 3 on Button Box. Undo is on the Safety page.',
      file: carFile(a),
    });
    expectOnlyThatRecord(before, await bytesOf(carFile(a)), 'LookLeft');
    expect(equal(await bytesOf(allCars(a)), general)).toBe(true);
    const entries = await journal(a);
    expect(entries.map((e) => [e.path, e.groupReason])).toEqual([
      [carFile(a), 'iRacing bindings for mx5 mx52016: Look left bound to Button 3 on Button Box'],
    ]);
    const look = (await setOf(a, CAR)).actions.find((x) => x.id === 'LookLeft')!;
    expect(look).toMatchObject({
      binding: { device: BOX, input: 'Button 3' },
      differs: true,
      general: 'FANATEC Podium Wheel Base DD2: Button 4',
    });
  });

  it('writes the control profile iRacing uses, never the older controls.cfg beside it', async () => {
    const a = (app = await wiredApp('iracing-bindings-profiles', {
      files: ['Documents/iRacing/**'],
    }));
    const profile = path.join(iracingDir(a), 'profiles', 'controls', 'Baseline', 'controls.cfg');
    const older = await bytesOf(allCars(a));
    const before = await bytesOf(profile);

    // The same two changes as the rig test of 13 Nov 2026: a wheel button and Shift+J.
    const button = await change(a, {
      set: 'all',
      action: 'HeadlightFlash',
      binding: { kind: 'button', device: WHEEL, button: 8 },
    });
    expect(button).toMatchObject({ changed: true, file: profile });
    const afterButton = await bytesOf(profile);
    expectOnlyThatRecord(before, afterButton, 'HeadlightFlash');
    const keyed = await change(a, { set: 'all', action: 'BlackBoxShowNext', binding: key(74, 3) });
    expect(keyed).toMatchObject({ changed: true, file: profile });
    expectOnlyThatRecord(afterButton, await bytesOf(profile), 'BlackBoxShowNext');

    // The records as iRacing has them for the same button and the same key elsewhere.
    const parsed = parseControlsFile(await bytesOf(profile));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const hex = (action: string): string =>
      Buffer.from(parsed.value.records.find((r) => r.action === action)!.data).toString('hex');
    expect(hex('HeadlightFlash')).toBe(
      '000000000600000002000000800000000000000000000000000000000000000000000000' +
        'a1bed445a160d8178001444553540000b70e0700000000000000504944564944'
    );
    expect(hex('BlackBoxShowNext')).toBe(
      '0100000006000000040000004a00000000000300' + '00'.repeat(48)
    );
    // The size of the file and its header stay as iRacing wrote them.
    expect(afterButton.length).toBe(before.length);
    expect(equal((await bytesOf(profile)).subarray(0, 0xab), before.subarray(0, 0xab))).toBe(true);

    // The older file is not touched, and both entries on the Safety page name the profile.
    expect(equal(await bytesOf(allCars(a)), older)).toBe(true);
    expect((await journal(a)).map((e) => e.path)).toEqual([profile, profile]);
    expect(await bindingOf(a, 'all', 'BlackBoxShowNext')).toMatchObject({ input: 'Shift+J' });
  });
});

/** The rig of 12:27 on 13 Nov 2026: Baseline for all cars, and the CTS-V's own profile. */
async function startCarProfile(): Promise<WiredApp> {
  return (app = await wiredApp('iracing-bindings-profile-car', {
    files: ['Documents/iRacing/**'],
  }));
}
const profileOf = (a: WiredApp, name: string): string =>
  path.join(iracingDir(a), 'profiles', 'controls', name, 'controls.cfg');
const writeIni = (a: WiredApp, lines: string): Promise<void> =>
  mutate(a, [
    {
      op: 'writeFile',
      path: 'Documents/iRacing/app.ini',
      content: `[Audio]\r\nvolume=1\r\n\r\n[ControlProfiles]\r\n${lines}\r\n[Drive Screen]\r\nblackBox=2\r\n`,
    },
  ]);
const CTSV = 'car:cadillacctsvr';
const FLASH_ON_WHEEL_8: ChangeRequest = {
  set: CTSV,
  action: 'HeadlightFlash',
  binding: { kind: 'button', device: WHEEL, button: 8 },
};

describe('changing an iRacing binding: a car’s own control profile', () => {
  it('previews, backs up and writes the car’s profile, and nothing else', async () => {
    const a = await startCarProfile();
    const car = profileOf(a, 'Test Profile CTSV');
    const baseline = profileOf(a, 'Baseline');
    const before = await bytesOf(car);
    const baselineBefore = await bytesOf(baseline);
    const older = await bytesOf(allCars(a));

    const shown = await review(a, FLASH_ON_WHEEL_8);
    expect(shown.set).toMatchObject({ id: CTSV, file: car, profile: 'Test Profile CTSV' });
    expect(shown.set.sharedWith).toBeUndefined();
    expect(shown.preview.files.map((f) => f.path)).toEqual([car]);
    expect(equal(await bytesOf(car), before)).toBe(true);

    const result = await change(a, { ...FLASH_ON_WHEEL_8, seen: shown.seen });
    expect(result).toEqual({
      changed: true,
      message:
        'Saved in iRacing’s file for cadillacctsvr: Flash headlights is now bound to Button 8 on FANATEC Podium Wheel Base DD2. Undo is on the Safety page.',
      file: car,
    });
    expectOnlyThatRecord(before, await bytesOf(car), 'HeadlightFlash');
    // The profile for all cars and the older file beside the profiles are left as they were.
    expect(equal(await bytesOf(baseline), baselineBefore)).toBe(true);
    expect(equal(await bytesOf(allCars(a)), older)).toBe(true);
    const entries = await journal(a);
    expect(entries.map((e) => [e.path, e.groupReason])).toEqual([
      [
        car,
        'iRacing bindings for cadillacctsvr: Flash headlights bound to Button 8 on FANATEC Podium Wheel Base DD2',
      ],
    ]);
    expect(equal(await bytesOf(entries[0]!.backupPath!), before)).toBe(true);
    expect((await a.ports.files.undoGroup(entries[0]!.groupId!)).ok).toBe(true);
    expect(equal(await bytesOf(car), before)).toBe(true);
  });

  it('names every car that shares the profile, before saving and after', async () => {
    const a = await startCarProfile();
    // Two cars on one profile: a change for one is a change for both.
    await writeIni(
      a,
      'cadillacctsvr=Test Profile CTSV\r\nbmwm4gt3=Test Profile CTSV\r\nGlobal=Baseline'
    );
    const sets = (await a.invoke<Overview>('iracing-bindings:overview')).sets;
    expect(sets.map((s) => [s.id, s.sharedWith])).toEqual([
      ['all', undefined],
      ['car:bmwm4gt3', ['cadillacctsvr']],
      [CTSV, ['bmwm4gt3']],
    ]);
    const shown = await review(a, FLASH_ON_WHEEL_8);
    expect(shown.set.sharedWith).toEqual(['bmwm4gt3']);
    const result = await change(a, { ...FLASH_ON_WHEEL_8, seen: shown.seen });
    const scope = 'cadillacctsvr and bmwm4gt3, which share the profile “Test Profile CTSV”';
    expect(result.message).toBe(
      `Saved in iRacing’s file for ${scope}: Flash headlights is now bound to Button 8 on FANATEC Podium Wheel Base DD2. Undo is on the Safety page.`
    );
    expect((await journal(a)).map((e) => e.groupReason)).toEqual([
      `iRacing bindings for ${scope}: Flash headlights bound to Button 8 on FANATEC Podium Wheel Base DD2`,
    ]);
    // The other car has the change too, as the message said.
    expect(await bindingOf(a, 'car:bmwm4gt3', 'HeadlightFlash')).toMatchObject({
      input: 'Button 8',
    });
  });

  it('writes nothing when another car joined the profile after the preview', async () => {
    const a = await startCarProfile();
    const car = profileOf(a, 'Test Profile CTSV');
    const shown = await review(a, FLASH_ON_WHEEL_8);
    await writeIni(
      a,
      'cadillacctsvr=Test Profile CTSV\r\nbmwm4gt3=Test Profile CTSV\r\nGlobal=Baseline'
    );
    const before = await bytesOf(car);
    expect(await refused(a, 'change', { ...FLASH_ON_WHEEL_8, seen: shown.seen })).toBe(
      'iracing-bindings.edit.changed'
    );
    expect(equal(await bytesOf(car), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('writes nothing when app.ini points All cars at another profile with the same bytes', async () => {
    const a = await startCarProfile();
    const baseline = profileOf(a, 'Baseline');
    const copy = profileOf(a, 'Copy');
    await mutate(a, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/Copy/controls.cfg',
        from: baseline,
      },
    ]);
    expect(equal(await bytesOf(copy), await bytesOf(baseline))).toBe(true);
    const request: ChangeRequest = {
      set: 'all',
      action: 'HeadlightFlash',
      binding: { kind: 'button', device: WHEEL, button: 8 },
    };
    const shown = await review(a, request);
    expect(shown.set.file).toBe(baseline);
    // iRacing now uses the copy for all cars: the same content, another file.
    await writeIni(a, 'cadillacctsvr=Test Profile CTSV\r\nGlobal=Copy');
    const copyBefore = await bytesOf(copy);
    const baselineBefore = await bytesOf(baseline);
    expect(await refused(a, 'change', { ...request, seen: shown.seen })).toBe(
      'iracing-bindings.edit.changed'
    );
    expect(equal(await bytesOf(copy), copyBefore)).toBe(true);
    expect(equal(await bytesOf(baseline), baselineBefore)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });
});

describe('changing an iRacing binding: when it is refused', () => {
  it('while iRacing runs: the reason is shown before saving and nothing is written', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));
    // The launcher is not the simulator: it does not write these files.
    await mutate(a, [
      { op: 'startProcess', name: 'iRacingUI.exe', path: 'C:\\iRacing\\ui\\iRacingUI.exe' },
    ]);
    expect((await review(a, FLASH_ON_7)).blocked).toBeUndefined();

    await mutate(a, [SIMULATOR]);
    const shown = await review(a, FLASH_ON_7);
    expect(shown.blocked).toBe(CLOSE_FIRST);
    // The rest of the review is still there to read.
    expect(shown).toMatchObject({ before: 'Not bound', after: 'Button 7 on Button Box' });
    expect(await call(a, 'change', FLASH_ON_7)).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.edit.blocked', message: CLOSE_FIRST },
    });
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);

    // Closed again: it saves.
    await mutate(a, [{ op: 'stopProcess', name: 'iRacingSim64DX11.exe' }]);
    expect((await change(a, FLASH_ON_7)).changed).toBe(true);
  });

  it('when RigReady cannot see which programs run: not knowing is not "closed"', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));
    await mutate(a, [{ op: 'failProvider', port: 'processes', message: 'Access denied.' }]);
    const why =
      'RigReady could not see which programs are running, so it cannot tell whether iRacing is open.';
    expect((await review(a, FLASH_ON_7)).blocked).toBe(why);
    expect(await call(a, 'change', FLASH_ON_7)).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.edit.blocked', message: why },
    });
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('a controller that is not plugged in, and a button the controller does not have', async () => {
    const a = await start();
    for (const device of [HANDBRAKE, 'keyboard', '', '..\\..\\x']) {
      const request = {
        set: 'all',
        action: 'HeadlightFlash',
        binding: { kind: 'button', device, button: 1 },
      };
      for (const channel of ['changePreview', 'change']) {
        expect(await call(a, channel, request), device).toMatchObject({
          ok: false,
          error: {
            code: 'iracing-bindings.edit.unplugged',
            message: 'That controller is not plugged in. Plug it in and press the button again.',
          },
        });
      }
    }
    // The button box has 32 buttons.
    expect(await call(a, 'change', { ...FLASH_ON_7, binding: boxButton(33) })).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.edit.button', message: 'Button Box has no button 33.' },
    });
    expect((await review(a, { ...FLASH_ON_7, binding: boxButton(32) })).after).toBe(
      'Button 32 on Button Box'
    );
    // The id is matched however it is written, and stored as Windows has it.
    await change(a, {
      ...FLASH_ON_7,
      binding: { kind: 'button', device: `{${BOX.toLowerCase()}}`, button: 32 },
    });
    expect(await bindingOf(a, 'all', 'HeadlightFlash')).toMatchObject({
      device: BOX,
      input: 'Button 32',
    });
    expect(await journal(a)).toHaveLength(1);
  });

  it('a set or an action that is not there, an axis, and a kind the action does not take', async () => {
    const a = await start();
    const before = await bytesOf(allCars(a));
    const wanted = key(72);
    const cases: [ChangeRequest, string][] = [
      [{ set: 'car:ferrari296gt3', action: 'Starter', binding: wanted }, 'iracing-bindings.noSet'],
      [{ set: 'car:..\\..', action: 'Starter', binding: wanted }, 'iracing-bindings.noSet'],
      [{ set: allCars(a), action: 'Starter', binding: wanted }, 'iracing-bindings.noSet'],
      [{ set: 'all', action: 'NoSuchAction', binding: wanted }, 'iracing-bindings.edit.noAction'],
      [{ set: 'all', action: 'Throttle', binding: wanted }, 'iracing-bindings.edit.axis'],
      [{ set: 'all', action: 'Throttle', binding: null }, 'iracing-bindings.edit.axis'],
      [{ set: 'all', action: 'BrakeBiasLevel', binding: wanted }, 'iracing-bindings.edit.kind'],
      [{ set: 'all', action: 'Starter', binding: key(250) }, 'iracing-bindings.edit.key'],
      [
        { set: 'all', action: 'Starter', binding: key(72, 0x01) },
        'iracing-bindings.edit.modifiers',
      ],
    ];
    for (const [request, code] of cases) {
      expect(await refused(a, 'changePreview', request), JSON.stringify(request)).toBe(code);
      expect(await refused(a, 'change', request), JSON.stringify(request)).toBe(code);
    }
    // What the page could never send is stopped before the feature sees it.
    for (const binding of [
      { kind: 'button', device: BOX, button: 0 },
      { kind: 'button', device: BOX, button: 129 },
      { kind: 'button', device: BOX, button: 1.5 },
      { kind: 'key', keyCode: 256, modifiers: 0 },
      { kind: 'key', keyCode: 72, modifiers: 64 },
      { kind: 'axis', device: BOX, axis: 1 },
      undefined,
    ]) {
      const request = { set: 'all', action: 'Starter', binding };
      expect(await refused(a, 'change', request), JSON.stringify(binding)).toBe('ipc.input');
    }
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('a file iRacing damaged or that is not a bindings file', async () => {
    const a = await start();
    await fs.writeFile(allCars(a), 'not a bindings file');
    expect(await refused(a, 'changePreview', FLASH_ON_7)).toBe('iracing-bindings.file');
    expect(await refused(a, 'change', FLASH_ON_7)).toBe('iracing-bindings.file');
    expect(await fs.readFile(allCars(a), 'utf8')).toBe('not a bindings file');
    expect(await journal(a)).toEqual([]);
  });
});

describe('changing an iRacing binding: binding by pressing', () => {
  const pressed = (a: WiredApp): unknown[] =>
    a.events.filter((e) => e.channel === 'iracing-bindings:event:pressed').map((e) => e.payload);

  it('reports what is pressed on any controller while the page listens, and stops when told', async () => {
    const a = await start();
    const box = a.ports.input.devices().find((d) => d.name === 'Button Box')!;
    const wheel = a.ports.input.devices().find((d) => d.guid === WHEEL)!;
    expect(await call(a, 'listenStart')).toEqual({ ok: true, value: { listening: true } });

    // The first state of a controller is how it rests: a button held then is not a press.
    a.ports.input.emit([stateOf(box, [2]), stateOf(wheel)]);
    expect(pressed(a)).toEqual([]);
    a.ports.input.emit([stateOf(box, [2, 7])]);
    expect(pressed(a)).toEqual([
      { device: BOX, deviceName: 'Button Box', kind: 'button', button: 7, label: 'Button 7' },
    ]);
    // A hat and an axis are heard too, so the page can say why it does not take them.
    a.ports.input.emit([stateOf(wheel, [], { hats: [[0, -1]] })]);
    a.ports.input.emit([
      stateOf(wheel, [], { axes: wheel.axisNames.map((_, i) => (i === 0 ? 0.9 : 0)) }),
    ]);
    expect(pressed(a).slice(1)).toEqual([
      {
        device: WHEEL,
        deviceName: 'FANATEC Podium Wheel Base DD2',
        kind: 'hat',
        label: 'a hat switch',
      },
      {
        device: WHEEL,
        deviceName: 'FANATEC Podium Wheel Base DD2',
        kind: 'axis',
        label: 'an axis',
      },
    ]);

    // Starting again does not report a press twice.
    expect(await call(a, 'listenStart')).toMatchObject({ ok: true });
    a.ports.input.emit([stateOf(box)]);
    a.ports.input.emit([stateOf(box, [12])]);
    expect(pressed(a)).toHaveLength(4);
    expect(pressed(a)[3]).toMatchObject({ device: BOX, button: 12 });

    expect(await call(a, 'listenStop')).toEqual({ ok: true, value: { listening: false } });
    a.ports.input.emit([stateOf(box)]);
    a.ports.input.emit([stateOf(box, [5])]);
    expect(pressed(a)).toHaveLength(4);
  });

  it('a listen stopped while the controllers were still starting reports nothing afterwards', async () => {
    const a = await start();
    const box = a.ports.input.devices().find((d) => d.name === 'Button Box')!;
    // The input reader takes its time to start (seconds, on a real PC).
    const input = a.ports.input;
    const real = input.start.bind(input);
    const held: (() => void)[] = [];
    input.start = () => new Promise((resolve) => held.push(() => void real().then(resolve)));
    const starting = call(a, 'listenStart');
    await expect.poll(() => held.length).toBe(1);
    // The user pressed Clear, or Close, before it answered: the page stops listening.
    expect(await call(a, 'listenStop')).toEqual({ ok: true, value: { listening: false } });
    held[0]!();
    expect(await starting).toEqual({ ok: true, value: { listening: false } });
    input.start = real;

    a.ports.input.emit([stateOf(box)]);
    a.ports.input.emit([stateOf(box, [5])]);
    expect(pressed(a)).toEqual([]);
    // A listen nothing cuts short still hears the press.
    expect(await call(a, 'listenStart')).toEqual({ ok: true, value: { listening: true } });
    a.ports.input.emit([stateOf(box)]);
    a.ports.input.emit([stateOf(box, [5])]);
    expect(pressed(a)).toHaveLength(1);
    await call(a, 'listenStop');
  });

  it('calls a controller by the name its owner gave it', () => {
    const device = {
      index: 3,
      name: 'Button Box  ',
      guid: BOX,
      productGuid: '00011209-0000-0000-0000-504944564944',
      vendorId: '1209',
      productId: '0001',
      numAxes: 0,
      numButtons: 32,
      numHats: 0,
      axisNames: [],
    } as unknown as InputDevice;
    const asked: unknown[] = [];
    const names = {
      nameOf: (ids: unknown) => {
        asked.push(ids);
        return 'Left box';
      },
    };
    expect(pressedOf({ input: 'JOY_BTN5', kind: 'button', device }, names)).toEqual({
      device: BOX,
      deviceName: 'Left box',
      kind: 'button',
      button: 5,
      label: 'Button 5',
    });
    expect(asked).toEqual([{ vendorId: '1209', productId: '0001', guid: BOX }]);
    // Without a given name: the name Windows has, without the spaces some devices pad it with.
    expect(
      pressedOf({ input: 'JOY_BTN_POV1_U', kind: 'hat', device }, { nameOf: () => undefined })
    ).toEqual({ device: BOX, deviceName: 'Button Box', kind: 'hat', label: 'a hat switch' });
  });
});
