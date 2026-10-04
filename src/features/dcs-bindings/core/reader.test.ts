import { afterEach, describe, expect, it } from 'vitest';
import { BindingRegistry } from '../../../core/bindings';
import { BINDING_FILES, bindingsFor, HORNET } from '../../../../tests/dcsBindings';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { createBindingReader } from './reader';

let rig: TestRig;
afterEach(() => rig?.cleanup());

describe('DCS bindings through core (ctx.bindings)', () => {
  it('lists the aircraft, the ones with bindings of the user first', async () => {
    rig = await scenarioRig('dcs-bindings-hornet', { files: BINDING_FILES });
    const reader = createBindingReader(bindingsFor(rig));
    expect(await reader.available()).toBe(true);
    const aircraft = await reader.aircraft();
    if (!aircraft.ok) throw new Error(aircraft.error.message);
    expect(aircraft.value[0]).toEqual({ id: HORNET, name: 'F/A-18C', hasUserBindings: true });
    expect(aircraft.value.find((a) => a.id === 'UH-1H')).toMatchObject({ name: 'UH-1H' });
  });

  it('gives the effective bindings of an aircraft per device: input, label, action, category, source, modifiers', async () => {
    rig = await scenarioRig('dcs-bindings-hornet', { files: BINDING_FILES });
    const reader = createBindingReader(bindingsFor(rig));
    const result = await reader.bindings(HORNET);
    if (!result.ok) throw new Error(result.error.message);
    const { aircraft, devices } = result.value;
    expect(aircraft).toEqual({ id: HORNET, name: 'F/A-18C', hasUserBindings: true });

    const stick = devices.find((d) => d.name.startsWith('WINWING Orion Joystick'))!;
    expect(stick).toMatchObject({
      kind: 'controller',
      connected: true,
      guid: '806DDF00-B756-11F0-8023-444553540000',
      vendorId: '4098',
      productId: 'BEA8',
    });
    const pitch = stick.bindings.find((b) => b.input === 'JOY_Y')!;
    expect(pitch).toMatchObject({ inputLabel: 'Y axis', kind: 'axis', action: 'Pitch' });
    const sources = new Set(devices.flatMap((d) => d.bindings.map((b) => b.source)));
    expect([...sources].sort()).toEqual(['default', 'user']);
    // Every binding names its action and its input in plain language.
    for (const device of devices) {
      for (const b of device.bindings) {
        expect(b.action.length).toBeGreaterThan(0);
        expect(b.inputLabel.length).toBeGreaterThan(0);
        expect(b.actionId).toMatch(/^(key|axis):/);
      }
    }
    // The same bindings the bindings page shows: nothing that cannot fire.
    const view = await bindingsFor(rig).view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    const active = view.value.devices.find((d) => d.name === stick.name)!.counts.active;
    expect(stick.bindings).toHaveLength(active);

    const keyboard = devices.find((d) => d.kind === 'keyboard')!;
    expect(keyboard.guid).toBeUndefined();
    const withModifier = keyboard.bindings.find((b) => b.modifiers.length > 0)!;
    expect(withModifier.kind).toBe('key');
    expect(withModifier.inputLabel).not.toContain(' + ');
  });

  it('says where a device and aircraft are shown, and fails cleanly for an unknown aircraft', async () => {
    rig = await scenarioRig('dcs-bindings-hornet', { files: BINDING_FILES });
    const reader = createBindingReader(bindingsFor(rig));
    expect(reader.route()).toBe('/configure/dcs-bindings/devices');
    expect(
      reader.route({ guid: '{806ddf00-b756-11f0-8023-444553540000}', aircraftId: HORNET })
    ).toBe(
      '/configure/dcs-bindings/devices?aircraft=FA-18C_hornet&guid=806DDF00-B756-11F0-8023-444553540000'
    );
    const unknown = await reader.bindings('No-Such-Aircraft');
    expect(unknown.ok).toBe(false);
  });

  it('is not available on a PC without DCS', async () => {
    rig = await scenarioRig('dcs-bindings-no-dcs', { files: [] });
    const reader = createBindingReader(bindingsFor(rig));
    expect(await reader.available()).toBe(false);
    const aircraft = await reader.aircraft();
    expect(aircraft.ok && aircraft.value).toEqual([]);
  });

  it('the registry holds one reader per game', () => {
    const registry = new BindingRegistry();
    const reader = createBindingReader(undefined as never);
    registry.register(reader);
    expect(registry.get('dcs')).toBe(reader);
    expect(registry.get('msfs')).toBeUndefined();
    expect(registry.all()).toEqual([reader]);
    expect(() => registry.register(reader)).toThrow(/already/);
  });
});
