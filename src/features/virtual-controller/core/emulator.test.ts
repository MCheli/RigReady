import { afterEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../../../core/logger';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import { sabotage } from '../../../../tests/sabotage';
import type { InputState } from '../../../shared/models';
import { Emulator } from './emulator';
import type { Running } from './running';
import { ProfileStore } from './store';

const STICK = 9;
const RUDDER = 2;
const THROTTLE = 10;
const READER = /resources\\python\\python\.exe$/;

let rig: TestRig | undefined;
let emulator: Emulator | undefined;
afterEach(async () => {
  await emulator?.dispose();
  emulator = undefined;
  await rig?.cleanup();
  rig = undefined;
});

function state(
  index: number,
  axes: number[],
  buttons: boolean[] = [],
  hats: [number, number][] = []
): InputState {
  return { index, name: '', axes, buttons, hats, timestamp: 0 };
}

async function setUp(): Promise<{
  rig: TestRig;
  emulator: Emulator;
  changes: (Running | undefined)[];
  notes: string[];
}> {
  rig = await scenarioRig('virtual-controller-ready');
  const changes: (Running | undefined)[] = [];
  const notes: string[] = [];
  emulator = new Emulator(rig.ports, nullLogger, (running, note) => {
    changes.push(running);
    if (note) notes.push(note);
  });
  return { rig, emulator, changes, notes };
}

const named = (rig: TestRig, s: InputState): InputState => ({
  ...s,
  name: rig.ports.input.devices().find((d) => d.index === s.index)!.name,
});

async function profile(rig: TestRig, id = 'my-ace-combat-stick') {
  const got = await new ProfileStore(rig.ports).get(id);
  if (!got.ok) throw new Error(got.error.message);
  return got.value;
}

describe('the virtual controller', () => {
  it('plugs in, follows the stick, pedals and throttle, and goes away when stopped', async () => {
    const { rig, emulator, changes } = await setUp();
    const started = await emulator.start(await profile(rig), { hide: false, by: 'hand' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value).toMatchObject({
      profileName: 'My Ace Combat stick',
      kind: 'xbox360',
      by: 'hand',
      missing: [],
      hidden: [],
    });
    expect(started.value.controllers).toEqual([
      'WINWING Orion Joystick Base 2 + JGRIP-F16',
      'T-Pendular-Rudder',
      'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
    ]);
    expect(rig.ports.pads.calls).toEqual(['plug xbox360']);
    expect((await rig.ports.pads.status()).ok).toBe(true);

    // Stick right and pulled back, rudder a little left, throttle full forward, trigger and hat up.
    const stickAxes = [0.5, 0.6, 0, 0, 0, 0];
    rig.ports.input.emit([
      named(rig, state(STICK, stickAxes, [true], [[0, 1]])),
      named(rig, state(RUDDER, [0, 0, -0.5])),
      named(rig, state(THROTTLE, [1, 0, 0, 0, 0, 0, 0])),
    ]);
    const last = rig.ports.pads.reports.at(-1)!;
    expect(last.lx).toBeCloseTo((0.5 - 0.03) / 0.97);
    expect(last.ly).toBeCloseTo(-(0.6 - 0.03) / 0.97);
    expect(last.rx).toBeCloseTo(-(0.5 - 0.05) / 0.95);
    expect(last.rt).toBe(1);
    expect(last.lt).toBe(0);
    expect(last.buttons).toBe(0x1000 | 0x0001);
    expect(emulator.lastReport()).toEqual(last);

    // The same state again is not sent again.
    const count = rig.ports.pads.reports.length;
    rig.ports.input.emit([named(rig, state(STICK, stickAxes, [true], [[0, 1]]))]);
    expect(rig.ports.pads.reports.length).toBe(count);

    const stopped = await emulator.stop();
    expect(stopped).toEqual({ ok: true, value: 'Virtual controller off (My Ace Combat stick)' });
    expect(rig.ports.pads.calls).toEqual(['plug xbox360', 'unplug']);
    expect((await rig.ports.pads.status()).ok && (await rig.ports.pads.status())).toMatchObject({
      value: { plugged: false },
    });
    expect(emulator.current()).toBeUndefined();
    expect(changes.map((c) => c?.profileId)).toEqual(['my-ace-combat-stick', undefined]);
    // Moving the stick after the stop sends nothing.
    const sent = rig.ports.pads.reports.length;
    rig.ports.input.emit([named(rig, state(STICK, [1, 1, 0, 0, 0, 0]))]);
    expect(rig.ports.pads.reports.length).toBe(sent);
    expect(await emulator.stop()).toEqual({ ok: true, value: null });
  });

  it('refuses without the driver, with nothing mapped, and with none of its controllers connected', async () => {
    const { rig, emulator } = await setUp();
    expect(
      await emulator.start(await profile(rig, 'starting-hotas'), { hide: false, by: 'hand' })
    ).toMatchObject({
      ok: false,
      error: { code: 'vc.nothing', message: expect.stringContaining('Nothing is mapped') },
    });
    await mutate(rig, [
      { op: 'unplugDevice', match: { vendorId: '4098', productId: 'BEA8' } },
      { op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } },
      { op: 'unplugDevice', match: { vendorId: '4098', productId: 'BD26' } },
    ]);
    expect(await emulator.start(await profile(rig), { hide: false, by: 'hand' })).toMatchObject({
      ok: false,
      error: { code: 'vc.nothing', message: expect.stringContaining('is connected') },
    });
    await mutate(rig, [{ op: 'setService', name: 'ViGEmBus', state: 'absent' }]);
    expect(await emulator.start(await profile(rig), { hide: false, by: 'hand' })).toMatchObject({
      ok: false,
      error: { code: 'vc.driver' },
    });
    expect(rig.ports.pads.calls).toEqual([]);
  });

  it('hides the real controllers with HidHide while it runs, keeps the reader allowed, and puts it all back', async () => {
    const { rig, emulator } = await setUp();
    const before = structuredClone(rig.ports.state.hidHide);
    const started = await emulator.start(await profile(rig), {
      hide: true,
      by: 'setup',
      setup: 'ACE COMBAT 8',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.hidden).toEqual(started.value.controllers);
    const hid = rig.ports.state.hidHide;
    expect(hid.cloak).toBe(true);
    expect(hid.hidden).toEqual([
      'HID\\VID_4098&PID_BEA8\\9&35be61a5&0&0000',
      'HID\\VID_044F&PID_B68F\\9&319d73f2&0&0000',
      'HID\\VID_4098&PID_BD26\\9&13288787&0&0000',
    ]);
    expect(hid.apps.some((a) => READER.test(a))).toBe(true);
    // Every change went through HidHide's own program, as an argument list.
    const changes = rig.ports.shell.calls.filter((c) => c.args.includes('--dev-hide'));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.args.at(-1)).toBe('--cloak-on');

    const stopped = await emulator.stop();
    expect(stopped.ok && stopped.value).toContain('Showed WINWING Orion Joystick Base 2');
    expect(rig.ports.state.hidHide).toEqual(before);
  });

  it('refuses to hide anything without HidHide, and plugs nothing in then', async () => {
    const { rig, emulator } = await setUp();
    await mutate(rig, [{ op: 'setHidHide', installed: false }]);
    expect(await emulator.start(await profile(rig), { hide: true, by: 'hand' })).toMatchObject({
      ok: false,
      error: { code: 'vc.hidhide', message: expect.stringContaining('not installed') },
    });
    expect(rig.ports.pads.calls).toEqual([]);
  });

  it('a driver that says it plugged in and did not is reported, and HidHide is put back', async () => {
    const { rig, emulator } = await setUp();
    const before = structuredClone(rig.ports.state.hidHide);
    const sab = sabotage(rig.ports);
    try {
      const started = await emulator.start(await profile(rig), { hide: true, by: 'hand' });
      expect(started).toMatchObject({ ok: false, error: { code: 'vc.notPlugged' } });
    } finally {
      sab.restore();
    }
    expect(emulator.current()).toBeUndefined();
    expect(rig.ports.state.hidHide).toEqual(before);
  });

  it('when the helper stops by itself, it says so and shows the controllers to games again', async () => {
    const { rig, emulator, notes } = await setUp();
    const before = structuredClone(rig.ports.state.hidHide);
    expect((await emulator.start(await profile(rig), { hide: true, by: 'hand' })).ok).toBe(true);
    rig.ports.pads.lose('The virtual controller helper stopped (exit code 1).');
    await expect.poll(() => emulator.current()).toBeUndefined();
    await expect.poll(() => rig.ports.state.hidHide).toEqual(before);
    await expect
      .poll(() => notes)
      .toEqual(['The virtual controller helper stopped (exit code 1).']);
  });

  it('after a crash, the next start shows hidden controllers to games again', async () => {
    const { rig, emulator } = await setUp();
    const before = structuredClone(rig.ports.state.hidHide);
    expect((await emulator.start(await profile(rig), { hide: true, by: 'hand' })).ok).toBe(true);
    expect(rig.ports.state.hidHide.cloak).toBe(true);
    // RigReady ended without stopping it: a new one starts on the same data folder.
    const next = new Emulator(rig.ports, nullLogger, () => undefined);
    const recovered = await next.recover();
    expect(recovered.ok && recovered.value).toContain('Showed');
    expect(rig.ports.state.hidHide).toEqual(before);
    expect(await next.recover()).toEqual({ ok: true, value: null });
  });
});
