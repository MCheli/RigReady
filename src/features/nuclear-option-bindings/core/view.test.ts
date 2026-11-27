import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Overview, OverviewDevice } from '../contract';
import type { InputDevice } from '../../../shared/models';
import type { ElementMap } from './rewired';
import { controlOf, REGISTRY_KEY } from './view';

/**
 * Nuclear Option's bindings on fixtures/scenarios/nuclear-option-bindings.yaml: a generic
 * PC with the game, a Warthog stick and throttle plugged in, and the registry values the
 * game saved (the files in fixtures/nuclear-option).
 */
const fixtures = path.join(__dirname, '..', '..', '..', '..', 'fixtures');

describe('Nuclear Option bindings', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const overview = (a: WiredApp): Promise<Overview> =>
    a.invoke<Overview>('nuclear-option-bindings:overview');
  const named = (view: Overview, name: string): OverviewDevice => {
    const device = view.devices.find((d) => d.name === name);
    if (!device) throw new Error(`no device ${name}`);
    return device;
  };
  const rows = (device: OverviewDevice): string[] =>
    device.bindings.map(
      (b) =>
        `${b.action} = ${[...b.modifiers, b.inputLabel].join('+')} [${b.input}]${b.inverted ? ' reversed' : ''}`
    );

  it('the scenario’s registry values are the fixture files, byte for byte', async () => {
    const scenario = yaml.load(
      await fs.readFile(path.join(fixtures, 'scenarios', 'nuclear-option-bindings.yaml'), 'utf8')
    ) as { mutations: { op: string; name?: string; value?: { type: string; value: string } }[] };
    const values = JSON.parse(
      await fs.readFile(path.join(fixtures, 'nuclear-option', 'values.json'), 'utf8')
    ) as { name: string; file: string }[];
    expect(values).toHaveLength(11);
    for (const { name, file } of values) {
      const text = await fs.readFile(path.join(fixtures, 'nuclear-option', file), 'utf8');
      const stored = scenario.mutations.find((m) => m.op === 'setRegistryValue' && m.name === name);
      expect(stored?.value, file).toEqual({
        type: 'binary',
        value: Buffer.from(`${text}\0`, 'utf8').toString('hex'),
      });
    }
  });

  it('shows each device the game has bindings for, the plugged-in controllers first', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const view = await overview(app);
    expect(view).toMatchObject({
      installed: true,
      saved: true,
      registryKey: 'HKEY_CURRENT_USER\\Software\\Shockfront\\NuclearOption',
      problems: [],
    });
    expect(view.devices.map((d) => [d.name, d.kind, d.connected])).toEqual([
      ['Throttle - HOTAS Warthog', 'controller', true],
      ['Joystick - HOTAS Warthog', 'controller', true],
      ['T-Rudder', 'controller', false],
      ['Keyboard', 'keyboard', true],
      ['Mouse', 'mouse', true],
    ]);
    expect(named(view, 'Joystick - HOTAS Warthog')).toMatchObject({
      guid: '3A7C1E20-7A11-11EF-8001-444553540000',
      vendorId: '044F',
      productId: '0402',
      controls: { buttons: 19, hats: 1, axes: ['X', 'Y'] },
    });
    expect(named(view, 'T-Rudder').guid).toBeUndefined();
  });

  it('names the stick’s bindings: the game’s button 0 is button 1, and a binding switched off is left out', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const stick = named(await overview(app), 'Joystick - HOTAS Warthog');
    expect(rows(stick)).toEqual([
      'Pitch Axis = Y axis [Axis 1] reversed',
      'Roll Axis = X axis [Axis 0]',
      'Fire = Button 1 [Button 0]',
      'Target Select = Button 2 [Button 1]',
      'Target Cancel = Button 5 [Button 4]',
      'Next Weapon = Button 3 [Button 2]',
      'Open Radial Menu = Button 4 [Button 3]',
    ]);
    expect(stick.bindings[2]).toMatchObject({
      actionId: '5',
      category: 'Flight Controls',
      mapCategory: 'Game',
      kind: 'button',
      control: { kind: 'button', index: 1 },
    });
  });

  it('where a later game build saved a controller again, the map the earlier build left behind is not shown', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const view = await overview(app);
    // One stick, with Fire on the button the later map names, not the one left behind.
    expect(view.devices.filter((d) => d.productId === '0402')).toHaveLength(1);
    const fire = named(view, 'Joystick - HOTAS Warthog').bindings.filter(
      (b) => b.action === 'Fire'
    );
    expect(fire.map((b) => b.inputLabel)).toEqual(['Button 1']);
    // The throttle was only ever saved the earlier way, and is read from that.
    expect(named(view, 'Throttle - HOTAS Warthog').bindings).toHaveLength(8);
  });

  it('names the throttle’s axes as the controller reports them, an axis side by its own name, and an action it does not know by number', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const view = await overview(app);
    expect(rows(named(view, 'Throttle - HOTAS Warthog'))).toEqual([
      'Throttle Axis = Z axis [Axis 2] reversed',
      'Apply Brakes = Z rotation (positive half) [Axis 3]',
      'Toggle Gear = Button 18 [Button 17]',
      'Eject = Button 32 [Button 31]',
      'Zoom In = Button 7 [Button 6]',
      'Zoom Out = Button 8 [Button 7]',
      'Custom Axis 1 = Slider 1 [Axis 4]',
      'Action 99 = Button 9 [Button 8]',
    ]);
    // Not plugged in: the axes are named in DirectInput's usual order.
    expect(rows(named(view, 'T-Rudder'))).toEqual(['Yaw Axis = Z axis [Axis 2]']);
  });

  it('an axis past the ones a plugged-in controller has is not given another axis’s name', () => {
    const axis = (id: number): ElementMap => ({
      actionCategoryId: 0,
      actionId: 0,
      elementType: 0,
      elementIdentifierId: id,
      axisRange: 0,
      invert: false,
      axisContribution: 0,
      keyboardKeyCode: 0,
      modifierKeys: [0, 0, 0],
      enabled: true,
    });
    const panel = { axisNames: ['X', 'Y', 'RX', 'RY'] } as InputDevice;
    expect(controlOf(axis(2), panel)).toEqual({ kind: 'axis', axis: 'RX' });
    expect(controlOf(axis(4), panel)).toBeUndefined();
    // Not plugged in, or a controller that did not say: the usual order.
    expect(controlOf(axis(4))).toEqual({ kind: 'axis', axis: 'RY' });
    expect(controlOf(axis(4), { axisNames: [] as string[] } as InputDevice)).toEqual({
      kind: 'axis',
      axis: 'RY',
    });
    expect(controlOf(axis(40))).toBeUndefined();
    expect(controlOf({ ...axis(31), elementType: 1 })).toBeUndefined();
  });

  it('names the keys with their modifier keys, and the mouse', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const view = await overview(app);
    expect(rows(named(view, 'Keyboard'))).toEqual([
      'Pitch Down = W [W]',
      'Pitch Up = S [S]',
      'Fire = Space [Space]',
      'Toggle Gear = G [G]',
      'Eject = Ctrl+Shift+E [E]',
      'Submit Chat = Enter [Enter]',
    ]);
    expect(named(view, 'Keyboard').bindings.at(-1)).toMatchObject({
      category: 'Chat',
      mapCategory: 'Chat',
      kind: 'key',
    });
    expect(rows(named(view, 'Mouse'))).toEqual([
      'Tilt View = Mouse up-down [Mouse up-down] reversed',
      'Pan View = Mouse left-right [Mouse left-right]',
      'Free Look = Right mouse button [Right mouse button]',
    ]);
  });

  it('is the reader the cheat sheets, the trainer and the overlay ask: one set for every aircraft', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const reader = app.wiring.context.bindings.get('nuclear-option');
    if (!reader) throw new Error('no reader');
    expect(reader.gameName).toBe('Nuclear Option');
    expect(await reader.available()).toBe(true);
    expect(await reader.aircraft()).toEqual({
      ok: true,
      value: [{ id: 'all', name: 'All aircraft', hasUserBindings: true, general: true }],
    });
    const bound = await reader.bindings('all');
    if (!bound.ok) throw new Error(bound.error.message);
    const stick = bound.value.devices.find((d) => d.name === 'Joystick - HOTAS Warthog')!;
    expect(stick).toMatchObject({
      kind: 'controller',
      guid: '3A7C1E20-7A11-11EF-8001-444553540000',
      connected: true,
    });
    expect(stick.bindings.find((b) => b.action === 'Fire')).toEqual({
      input: 'Button 0',
      inputLabel: 'Button 1',
      kind: 'button',
      control: { kind: 'button', index: 1 },
      modifiers: [],
      actionId: '5',
      action: 'Fire',
      category: ['Flight Controls'],
      source: 'user',
    });
    expect((await reader.bindings('F-16')).ok).toBe(false);
    expect(reader.route()).toBe('/configure/nuclear-option-bindings');
    expect(reader.route({ guid: '3A7C1E20-7A11-11EF-8001-444553540000' })).toBe(
      '/configure/nuclear-option-bindings?guid=3A7C1E20-7A11-11EF-8001-444553540000'
    );
    const actions = await reader.actions!('all');
    if (!actions.ok) throw new Error(actions.error.message);
    // 61 actions; each of the 17 axis actions is also its two sides, for a button or a key.
    expect(actions.value).toHaveLength(95);
    expect(new Set(actions.value.map((a) => a.id)).size).toBe(95);
    expect(actions.value.filter((a) => a.id.startsWith('25'))).toEqual([
      { id: '25', name: 'Zoom View', category: ['Camera Controls'], kind: 'axis', editable: false },
      {
        id: '25:+',
        name: 'Zoom In',
        category: ['Camera Controls'],
        kind: 'button',
        editable: false,
      },
      {
        id: '25:-',
        name: 'Zoom Out',
        category: ['Camera Controls'],
        kind: 'button',
        editable: false,
      },
    ]);
    // The two sides of one axis action are two actions to whoever asks what a button does:
    // the trainer must not take the Zoom Out button as the answer to Zoom In.
    const throttle = bound.value.devices.find((d) => d.name === 'Throttle - HOTAS Warthog')!;
    expect(
      throttle.bindings
        .filter((b) => b.action.startsWith('Zoom'))
        .map((b) => [b.action, b.actionId, b.inputLabel])
    ).toEqual([
      ['Zoom In', '25:+', 'Button 7'],
      ['Zoom Out', '25:-', 'Button 8'],
    ]);
    const keyboard = bound.value.devices.find((d) => d.kind === 'keyboard')!;
    expect(
      keyboard.bindings
        .filter((b) => b.action.startsWith('Pitch'))
        .map((b) => [b.action, b.actionId])
    ).toEqual([
      ['Pitch Down', '0:-'],
      ['Pitch Up', '0:+'],
    ]);
    // A whole axis keeps the action's own id.
    expect(throttle.bindings.find((b) => b.action === 'Throttle Axis')?.actionId).toBe('4');
    expect(actions.value[0]).toEqual({
      id: '0',
      name: 'Pitch Axis',
      category: ['Flight Controls'],
      kind: 'axis',
      editable: false,
    });
  });

  it('a saved map that cannot be read is said so, and the others are still shown', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const values = JSON.parse(
      await fs.readFile(path.join(fixtures, 'nuclear-option', 'values.json'), 'utf8')
    ) as { name: string; file: string }[];
    const stick = values.find((v) => v.file === 'stick.xml')!;
    await mutate(app, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name: stick.name,
        value: {
          type: 'binary',
          value: Buffer.from(
            '<JoystickMap><buttonMaps><oops/></buttonMaps></JoystickMap>',
            'utf8'
          ).toString('hex'),
        },
      },
    ]);
    const view = await overview(app);
    expect(view.problems).toEqual([
      'A saved JoystickMap could not be read: A binding in buttonMaps is not written the way Rewired writes one.',
    ]);
    expect(view.devices.map((d) => d.name)).toEqual([
      'Throttle - HOTAS Warthog',
      'T-Rudder',
      'Keyboard',
      'Mouse',
    ]);
  });

  it('when no saved map can be read, the page still says the game has saved bindings and why they cannot be read', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const values = JSON.parse(
      await fs.readFile(path.join(fixtures, 'nuclear-option', 'values.json'), 'utf8')
    ) as { name: string; file: string }[];
    await mutate(
      app,
      values.map((v) => ({
        op: 'setRegistryValue' as const,
        hive: 'HKCU' as const,
        key: REGISTRY_KEY,
        name: v.name,
        value: { type: 'binary' as const, value: Buffer.from('cut off', 'utf8').toString('hex') },
      }))
    );
    const view = await overview(app);
    expect(view.devices).toEqual([]);
    expect(view.saved).toBe(true);
    // Seven, not eight: the map an earlier build left for the stick is not looked at.
    expect(view.problems).toHaveLength(7);
    expect(view.problems[0]).toContain('could not be read');
    expect(await app.wiring.context.bindings.get('nuclear-option')!.available()).toBe(true);
  });

  it('with the game installed but never run, and on a PC without the game, nothing is shown and nothing fails', async () => {
    app = await wiredApp('games-nuclear-option');
    expect(await overview(app)).toMatchObject({ installed: true, saved: false, devices: [] });
    expect(await app.wiring.context.bindings.get('nuclear-option')!.available()).toBe(true);
    await app.cleanup();

    app = await wiredApp('generic-more-sims');
    expect(await overview(app)).toMatchObject({ installed: false, saved: false, devices: [] });
    expect(await app.wiring.context.bindings.get('nuclear-option')!.available()).toBe(false);
  });
});
