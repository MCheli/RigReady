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
import { EDIT_SWITCH, editingOn, pressedOf, refuseWhenOff } from './change';
import { RECORD_BYTES, parseControlsFile } from './controlsFile';
import { KEPT_BYTES } from './edit';

const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const BOX = '5EED0001-7A11-11EF-8004-444553540000';
const HANDBRAKE = '5EED0002-7A11-11EF-8005-444553540000';
const CAR = 'car:mx5 mx52016';
const OFF = {
  code: 'iracing-bindings.edit.off',
  message: 'RigReady does not change iRacing bindings yet. Change them in iRacing.',
};
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
  switchBefore = process.env[EDIT_SWITCH];
  delete process.env[EDIT_SWITCH];
});
afterEach(async () => {
  if (switchBefore === undefined) delete process.env[EDIT_SWITCH];
  else process.env[EDIT_SWITCH] = switchBefore;
  await app?.cleanup();
  app = undefined;
});

/** The racing rig with a car that has custom controls and a button box plugged in. */
async function start(on: boolean): Promise<WiredApp> {
  if (on) process.env[EDIT_SWITCH] = '1';
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

describe('changing an iRacing binding: switched off unless someone turns it on', () => {
  it('is on only when RIGREADY_IRACING_EDIT is exactly 1', () => {
    expect(EDIT_SWITCH).toBe('RIGREADY_IRACING_EDIT');
    expect(editingOn({})).toBe(false);
    expect(editingOn({ [EDIT_SWITCH]: '1' })).toBe(true);
    for (const value of ['', '0', 'true', 'yes', ' 1', '1 ', 'on']) {
      expect(editingOn({ [EDIT_SWITCH]: value }), value).toBe(false);
    }
    // Read when asked, not when the program starts: the test turns it off above.
    expect(editingOn()).toBe(false);
    expect(refuseWhenOff({})).toMatchObject({ ok: false, error: OFF });
    expect(refuseWhenOff({ [EDIT_SWITCH]: '1' })).toEqual({ ok: true, value: undefined });
  });

  it('refuses every channel of it, reads nothing, listens to nothing and writes nothing', async () => {
    const a = await start(false);
    const general = await bytesOf(allCars(a));
    const car = await bytesOf(carFile(a));
    expect((await a.invoke<Overview>('iracing-bindings:overview')).editing).toBe(false);

    for (const request of [
      FLASH_ON_7,
      { set: CAR, action: 'Starter', binding: null },
      { set: 'all', action: 'HeadlightFlash', binding: key(72) },
      // Not looked at either: a set and an action that do not exist get the same answer.
      { set: 'car:nothing', action: 'Nothing', binding: null },
    ]) {
      expect(await call(a, 'changePreview', request)).toMatchObject({ ok: false, error: OFF });
      expect(await call(a, 'change', request)).toMatchObject({ ok: false, error: OFF });
    }
    expect(await call(a, 'listenStart')).toMatchObject({ ok: false, error: OFF });
    expect(await call(a, 'listenStop')).toEqual({ ok: true, value: { listening: false } });

    // A press on the button box reaches nobody.
    const box = a.ports.input.devices().find((d) => d.name === 'Button Box')!;
    a.ports.input.emit([stateOf(box)]);
    a.ports.input.emit([stateOf(box, [7])]);
    expect(a.events.filter((e) => e.channel.startsWith('iracing-bindings:'))).toEqual([]);

    expect(equal(await bytesOf(allCars(a)), general)).toBe(true);
    expect(equal(await bytesOf(carFile(a)), car)).toBe(true);
    expect(await journal(a)).toEqual([]);
    // Reading goes on as before.
    expect((await setOf(a, 'all')).counts.actions).toBe(367);
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
    const a = await start(true);
    const before = await bytesOf(allCars(a));
    expect((await a.invoke<Overview>('iracing-bindings:overview')).editing).toBe(true);

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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
      'controls.cfg changed after the change was shown, so nothing was written. Look at the change again.'
    );
    expect(equal(await bytesOf(allCars(a)), before)).toBe(true);
    expect(await journal(a)).toHaveLength(entries);

    // Looked at again, the conflict is named, and that preview can be saved.
    const again = await review(a, FLASH_ON_7);
    expect(again.conflicts.map((c) => c.id)).toContain('BlackBoxShowNext');
    expect((await change(a, { ...FLASH_ON_7, seen: again.seen })).changed).toBe(true);
  });

  it('binds a key and clears a binding, each as one entry of its own', async () => {
    const a = await start(true);
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
    const a = await start(true);
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
});

describe('changing an iRacing binding: when it is refused', () => {
  it('while iRacing runs: the reason is shown before saving and nothing is written', async () => {
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
    const a = await start(true);
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
