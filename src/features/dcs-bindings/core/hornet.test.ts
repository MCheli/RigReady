import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { BINDING_FILES, HORNET, bindingsFor } from '../../../../tests/dcsBindings';
import type { AircraftView, DeviceView } from './model';

let rig: TestRig;
afterEach(() => rig?.cleanup());

describe("the owner's F/A-18C, end to end", () => {
  it('every bound action has its name from DCS, and the known bindings are there', async () => {
    rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
    const result = await bindingsFor(rig).view(HORNET);
    if (!result.ok) throw new Error(result.error.message);
    const v: AircraftView = result.value;
    const nameOf = (id: string): string => v.commands.find((c) => c.id === id)?.name ?? id;
    const device = (prefix: string): DeviceView =>
      v.devices.find((d) => d.name.startsWith(prefix))!;

    expect(v.warnings).toEqual([]);
    // No binding in any file is left with a raw id: each matches an action of the default files.
    expect(v.commands.filter((c) => c.unmatched)).toEqual([]);
    const controllers = v.devices.filter((d) => d.type === 'joystick');
    const bindings = controllers.flatMap((d) => d.bindings);
    expect(bindings.length).toBeGreaterThan(400);
    for (const binding of bindings) {
      const name = nameOf(binding.commandId);
      expect(name).not.toBe(binding.commandId);
      expect(name).not.toMatch(/^[ad]\d|iCommand/);
    }
    const namesOn = (prefix: string): string[] =>
      device(prefix)
        .bindings.filter((b) => b.source === 'user')
        .map((b) => nameOf(b.commandId));
    const on = (prefix: string, key: string): string[] =>
      device(prefix)
        .bindings.filter((b) => b.combo.key === key && !b.inert)
        .map((b) => nameOf(b.commandId));

    // UFC keypad 0-9, CLR and ENT, the option select buttons and the function selectors.
    const ufc = namesOn('WINWING UFC1');
    for (const key of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', 'ENT']) {
      expect(ufc).toContain(`UFC Keyboard Pushbutton - ${key}`);
    }
    for (const n of [1, 2, 3, 4, 5]) expect(ufc).toContain(`UFC Option Select Pushbutton ${n}`);
    expect(ufc).toContain('UFC Function Selector Pushbutton - A/P');

    // All 20 pushbuttons of each MFD frame: left and right DDI and the AMPCD.
    for (const [frame, display] of [
      ['WINWING MFD1-L', 'Left MDI'],
      ['WINWING MFD1-R', 'Right MDI'],
      ['WINWING MFD1-C', 'AMPCD'],
    ] as const) {
      const names = namesOn(frame);
      for (let n = 1; n <= 20; n++) {
        expect(names, `${frame}: ${display} PB ${n}`).toContain(`${display} PB ${n}`);
      }
    }

    // Split throttle: left and right thrust on separate axes.
    expect(on('WINWING THROTTLE', 'JOY_RX')).toEqual(['Thrust Right']);
    expect(on('WINWING THROTTLE', 'JOY_RY')).toEqual(['Thrust Left']);
    // TPR pedals: rudder and both toe brakes.
    expect(on('T-Pendular-Rudder', 'JOY_Z')).toEqual(['Rudder']);
    expect(on('T-Pendular-Rudder', 'JOY_Y')).toEqual(['Wheel Brake Left']);
    expect(on('T-Pendular-Rudder', 'JOY_X')).toEqual(['Wheel Brake Right']);
  });
});
