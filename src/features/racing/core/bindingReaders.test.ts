import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BindingReader, BindingsChanged, BoundDevice } from '../../../core/bindings';
import { axisFromName, beamngControl, lmuControl, mergeAxisHalves } from './bindingReaders';
import { racingCategory } from './categories';

/**
 * The racing games' bindings for the rest of the app (cheat sheets, the input tester):
 * `ctx.bindings` readers on the racing rig, and on a PC without any of the games.
 */

const RACING_FILES = [
  'Documents/iRacing/**',
  'Documents/Assetto Corsa/**',
  'AppData/Local/BeamNG/**',
  'Program Files (x86)/Steam/steamapps/**',
];

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(scenario = 'mark-racing', files = RACING_FILES): Promise<WiredApp> {
  app = await wiredApp(scenario, { files });
  return app;
}

const reader = (game: string): BindingReader => {
  const found = app!.wiring.context.bindings.get(game);
  if (!found) throw new Error(`No reader for ${game}`);
  return found;
};

async function devicesOf(game: string, aircraftId = 'all'): Promise<BoundDevice[]> {
  const bindings = await reader(game).bindings(aircraftId);
  if (!bindings.ok) throw new Error(bindings.error.message);
  return bindings.value.devices;
}

const wheelOf = (devices: BoundDevice[]): BoundDevice => {
  const wheel = devices.find((d) => d.kind === 'controller');
  if (!wheel) throw new Error('No controller');
  return wheel;
};
const on = (device: BoundDevice, action: string) =>
  device.bindings.filter((b) => b.action === action).map((b) => b.control);

describe('binding readers of the racing games, on the racing rig', () => {
  it('registers a reader per racing game, each with the game’s own racing page as its route', async () => {
    await start();
    const racing = ['assetto-corsa', 'beamng', 'iracing', 'lmu'];
    const all = app!.wiring.context.bindings.all().map((r) => r.game);
    expect(all).toEqual(expect.arrayContaining(racing));
    for (const game of racing) {
      expect(await reader(game).available()).toBe(true);
      expect(reader(game).route()).toBe(`/configure/racing/${game}`);
      const sets = await reader(game).aircraft();
      expect(sets.ok && sets.value[0]).toMatchObject({ id: 'all' });
    }
    expect(reader('iracing').gameName).toBe('iRacing');
    expect(reader('lmu').gameName).toBe('Le Mans Ultimate');
  });

  it('reads iRacing: the wheel with its pedals and paddles as controls, the keyboard apart', async () => {
    await start();
    const devices = await devicesOf('iracing');
    const wheel = wheelOf(devices);
    expect(wheel).toMatchObject({
      name: 'FANATEC Podium Wheel Base DD2',
      vendorId: '0EB7',
      productId: '0007',
      connected: true,
      controls: { buttons: 108, hats: 1 },
    });
    expect(wheel.guid).toMatch(/^[0-9A-F-]{36}$/);
    // iRacing names axes its own way (joyCalib.yaml); here they are DirectInput's.
    expect(on(wheel, 'Throttle')).toEqual([{ kind: 'axis', axis: 'Z' }]);
    expect(on(wheel, 'Brake')).toEqual([{ kind: 'axis', axis: 'RZ' }]);
    // Steer left and steer right are the two halves of one axis: one thing to the driver.
    expect(on(wheel, 'Steering')).toEqual([{ kind: 'axis', axis: 'X' }]);
    expect(wheel.bindings.some((b) => /Steer (left|right)/.test(b.action))).toBe(false);
    // Buttons are numbered from 1, as DirectInput and the cheat sheet layouts number them.
    expect(on(wheel, 'Shift up')).toEqual([{ kind: 'button', index: 5 }]);
    expect(on(wheel, 'Shift down')).toEqual([{ kind: 'button', index: 6 }]);
    const shift = wheel.bindings.find((b) => b.action === 'Shift up')!;
    expect(shift).toMatchObject({
      actionId: 'ShiftUp',
      inputLabel: 'Button 5',
      kind: 'button',
      category: ['Driving'],
      source: 'user',
      modifiers: [],
    });
    const keyboard = devices.find((d) => d.kind === 'keyboard')!;
    expect(keyboard.bindings.find((b) => b.action === 'Pit speed limiter')).toMatchObject({
      kind: 'key',
      inputLabel: 'A',
    });
    expect(keyboard.bindings.every((b) => b.control === undefined)).toBe(true);
  });

  it('offers a set per car where iRacing keeps custom controls for one, and never takes an id as a path', async () => {
    await start();
    const dir = path.join(app!.ports.folders.documents(), 'iRacing');
    const car = path.join(dir, 'setups', 'mx5 mx52016');
    await fs.mkdir(car, { recursive: true });
    await fs.copyFile(path.join(dir, 'controls.cfg'), path.join(car, 'controls.cfg'));
    const sets = await reader('iracing').aircraft();
    expect(sets.ok && sets.value).toEqual([
      // The one set for every car is marked, so a page about it is titled "iRacing".
      { id: 'all', name: 'All cars', hasUserBindings: true, general: true },
      { id: 'car:mx5 mx52016', name: 'mx5 mx52016', hasUserBindings: true },
    ]);
    const own = await reader('iracing').bindings('car:mx5 mx52016');
    expect(own.ok && own.value.aircraft.name).toBe('mx5 mx52016');
    // The car's folder has no calibration of its own; the axes are still named.
    expect(own.ok && on(wheelOf(own.value.devices), 'Brake')).toEqual([
      { kind: 'axis', axis: 'RZ' },
    ]);
    for (const id of ['car:nothing', 'car:..', 'car:..\\..\\Assetto Corsa\\cfg', '../x']) {
      const refused = await reader('iracing').bindings(id);
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.message).toContain('no custom controls for that car');
    }
  });

  it('says the wheel iRacing knows is not connected when Windows gave it a new id', async () => {
    await start('racing-iracing-moved-wheel');
    const wheel = wheelOf(await devicesOf('iracing'));
    expect(wheel.connected).toBe(false);
    expect(wheel.controls).toBeUndefined();
    expect(wheel.bindings.length).toBeGreaterThan(10);
  });

  it('reads Le Mans Ultimate: hat directions, buttons, and a second binding of the same action', async () => {
    await start();
    const wheel = wheelOf(await devicesOf('lmu'));
    expect(wheel).toMatchObject({ vendorId: '0EB7', productId: '0007', connected: true });
    expect(on(wheel, 'Pit Menu Up')).toEqual([{ kind: 'hat', hat: 1, direction: 'U' }]);
    expect(on(wheel, 'Shift Up')).toEqual([{ kind: 'button', index: 5 }]);
    // Primary and alternative input of one action: the same action on two controls.
    expect(on(wheel, 'Bias Forward')).toEqual([
      { kind: 'button', index: 33 },
      { kind: 'button', index: 104 },
    ]);
    // A pedal is one half of an axis; it is still that axis.
    expect(wheel.bindings.find((b) => b.action === 'Brake')).toMatchObject({
      control: { kind: 'axis', axis: 'RZ' },
      inputLabel: 'Brake',
    });
    expect(on(wheel, 'Look Left / Look Right')).toEqual([{ kind: 'axis', axis: 'RX' }]);
    expect(wheel.bindings.find((b) => b.action === 'Pit Request')?.category).toEqual([
      'Pit & session',
    ]);
    const other = await reader('lmu').bindings('car:x');
    expect(!other.ok && other.error.message).toContain('one set of bindings');
  });

  it('reads BeamNG.drive: the game’s defaults and the user’s own, and a vehicle’s own map on top', async () => {
    await start();
    const general = await devicesOf('beamng');
    const wheel = wheelOf(general);
    expect(wheel).toMatchObject({ vendorId: '0EB7', productId: '0007', connected: true });
    expect(wheel.bindings.find((b) => b.actionId === 'steering')).toMatchObject({
      control: { kind: 'axis', axis: 'X' },
      source: 'user',
    });
    // "button11" in the file is the twelfth button.
    expect(wheel.bindings.find((b) => b.actionId === 'vehicle_selector')).toMatchObject({
      control: { kind: 'button', index: 12 },
      input: 'button11',
    });
    expect(general.some((d) => d.kind === 'keyboard')).toBe(true);

    const maps = path.join(
      app!.ports.folders.localAppData(),
      'BeamNG',
      'BeamNG.drive',
      'current',
      'settings',
      'inputmaps'
    );
    await fs.mkdir(path.join(maps, 'pickup'), { recursive: true });
    await fs.writeFile(
      path.join(maps, 'pickup', '00070eb7.diff'),
      JSON.stringify({ bindings: [{ action: 'horn', control: 'button7' }], vidpid: '00070eb7' })
    );
    const sets = await reader('beamng').aircraft();
    expect(sets.ok && sets.value.map((s) => s.id)).toEqual(['all', 'vehicle:pickup']);
    const pickup = wheelOf(await devicesOf('beamng', 'vehicle:pickup'));
    expect(pickup.bindings.find((b) => b.actionId === 'horn')?.control).toEqual({
      kind: 'button',
      index: 8,
    });
    // The general bindings still apply in the vehicle.
    expect(pickup.bindings.some((b) => b.actionId === 'steering')).toBe(true);
    expect(wheel.bindings.some((b) => b.actionId === 'horn' && b.input === 'button7')).toBe(false);
    const unknown = await reader('beamng').bindings('vehicle:../../x');
    expect(!unknown.ok && unknown.error.message).toContain('no bindings of its own');
  });

  it('reads Assetto Corsa: axes and buttons of the controller controls.ini names, keys apart', async () => {
    await start();
    const devices = await devicesOf('assetto-corsa');
    const wheel = wheelOf(devices);
    expect(wheel.connected).toBe(true);
    expect(on(wheel, 'Steering')).toEqual([{ kind: 'axis', axis: 'X' }]);
    expect(on(wheel, 'Shift up')).toEqual([{ kind: 'button', index: 5 }]);
    expect(wheel.bindings.find((b) => b.action === 'Throttle')?.inputLabel).toBe('Accelerator');
    const keyboard = devices.find((d) => d.kind === 'keyboard')!;
    expect(keyboard.bindings.find((b) => b.action === 'Horn')?.inputLabel).toBe('H');
  });

  it('tells the features that show bindings when a racing page changed a game’s files', async () => {
    await start('racing-iracing-moved-wheel');
    const seen: BindingsChanged[] = [];
    const off = app!.wiring.context.bindings.onChanged((change) => seen.push(change));
    const before = wheelOf(await devicesOf('iracing'));
    const live = app!.ports.input.devices().find((d) => d.vendorId === '0EB7')!;
    await app!.invoke('racing:iracingRepair', {
      mapping: [{ from: before.guid, to: live.guid }],
    });
    expect(seen).toEqual([{ game: 'iracing' }]);
    expect(wheelOf(await devicesOf('iracing')).connected).toBe(true);
    // A refused change announces nothing.
    await expect(
      app!.invoke('racing:iracingRepair', { mapping: [{ from: before.guid, to: live.guid }] })
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    off();
  });
});

describe('binding readers of the racing games, on a PC without the games', () => {
  it('are not available, list nothing and fail in words, never with an exception', async () => {
    await start('generic-fresh', []);
    for (const game of ['iracing', 'lmu', 'beamng', 'assetto-corsa']) {
      expect(await reader(game).available()).toBe(false);
      const sets = await reader(game).aircraft();
      expect(sets).toEqual({ ok: true, value: [] });
      const bindings = await reader(game).bindings('all');
      expect(bindings.ok).toBe(false);
      expect(!bindings.ok && bindings.error.message.length).toBeGreaterThan(10);
    }
    const overview = await app!.invoke<{ games: unknown[] }>('cheat-sheets:overview');
    expect(overview.games).toEqual([]);
  });

  it('are not available when a provider throws', async () => {
    await start('generic-fresh', []);
    app!.ports.files.exists = () => Promise.reject(new Error('disk gone'));
    // ctx.ports is a wrapped copy: break what the features really use.
    const ports = app!.wiring.context.ports;
    ports.files.exists = () => Promise.reject(new Error('disk gone'));
    for (const game of ['iracing', 'lmu', 'assetto-corsa']) {
      expect(await reader(game).available()).toBe(false);
    }
  });
});

describe('the games’ input names as controls', () => {
  it('numbers Le Mans Ultimate inputs: axis halves, hats, then buttons', () => {
    expect(lmuControl(0)).toEqual({ control: { kind: 'axis', axis: 'X' }, half: '+' });
    expect(lmuControl(13)).toEqual({ control: { kind: 'axis', axis: 'SLIDER1' }, half: '-' });
    expect(lmuControl(16)?.control).toEqual({ kind: 'hat', hat: 1, direction: 'U' });
    expect(lmuControl(23)?.control).toEqual({ kind: 'hat', hat: 2, direction: 'L' });
    expect(lmuControl(32)?.control).toEqual({ kind: 'button', index: 1 });
    expect(lmuControl(-1)).toBeUndefined();
    expect(lmuControl(1.5)).toBeUndefined();
  });

  it('reads BeamNG control names, and leaves what is not on a DirectInput controller alone', () => {
    expect(beamngControl('button0')).toEqual({ kind: 'button', index: 1 });
    expect(beamngControl('rzaxis')).toEqual({ kind: 'axis', axis: 'RZ' });
    expect(beamngControl('slider2')).toEqual({ kind: 'axis', axis: 'SLIDER2' });
    expect(beamngControl('lpov')).toEqual({ kind: 'hat', hat: 1, direction: 'L' });
    expect(beamngControl('thumblx')).toBeUndefined();
    expect(beamngControl('space')).toBeUndefined();
  });

  it('finds the DirectInput axis behind the name iRacing calibrated it under', () => {
    expect(axisFromName('Wheel Axis', '0EB7', '0007')).toBe('X');
    expect(axisFromName('Combined Pedals', '0EB7', '0007')).toBe('Y');
    expect(axisFromName('Clutch', '0EB7', '0007')).toBe('SLIDER1');
    expect(axisFromName('Z Rotation', '046D', 'C215')).toBe('RZ');
    expect(axisFromName('X Axis')).toBe('X');
    expect(axisFromName('Mystery lever', '0EB7', '0007')).toBeUndefined();
    expect(axisFromName('')).toBeUndefined();
  });

  it('joins the two halves of an axis into one binding, and leaves a lone half as it is', () => {
    const half = (action: string, axis: string, side: '+' | '-') => ({
      input: axis,
      inputLabel: axis,
      kind: 'axis' as const,
      control: { kind: 'axis' as const, axis },
      modifiers: [],
      actionId: action,
      action,
      category: [],
      source: 'user' as const,
      half: side,
    });
    const merged = mergeAxisHalves([
      half('Steer Left', 'X', '-'),
      half('Brake', 'RZ', '-'),
      half('Steer Right', 'X', '+'),
      half('Zoom in', 'RY', '+'),
      half('Zoom out', 'RY', '-'),
    ]);
    expect(merged.map((b) => [b.action, b.actionId])).toEqual([
      ['Steering', 'steering'],
      ['Brake', 'Brake'],
      ['Zoom in / Zoom out', 'Zoom in+Zoom out'],
    ]);
    expect(merged.every((b) => !('half' in b))).toBe(true);
  });

  it('sorts racing actions into kinds a driver would name', () => {
    expect(racingCategory('Brake bias up')).toBe('Car adjustments');
    expect(racingCategory('Brake')).toBe('Driving');
    expect(racingCategory('Shift up')).toBe('Driving');
    expect(racingCategory('Pit Request')).toBe('Pit & session');
    expect(racingCategory('Look left')).toBe('View');
    expect(racingCategory('Chat macro 3')).toBe('Radio & chat');
    expect(racingCategory('Telemetry marker')).toBe('Other');
  });
});
