import { describe, expect, it } from 'vitest';
import type { AircraftBindings, BoundInput } from '../../../core/bindings';
import type { InputState } from '../../../shared/models';
import { boundControl, boundInputsOf } from './bound';
import { ActivityLog, gameInputLabel } from './input';

const reader = {
  game: 'dcs',
  gameName: 'DCS World',
  route: (target?: { guid?: string; aircraftId?: string }) =>
    `/bindings?guid=${target?.guid ?? ''}&aircraft=${target?.aircraftId ?? ''}`,
};

const binding = (input: string, action: string, extra: Partial<BoundInput> = {}): BoundInput => ({
  input,
  inputLabel: gameInputLabel(input),
  kind: 'button',
  modifiers: [],
  actionId: `key:${action}`,
  action,
  category: ['HOTAS'],
  source: 'user',
  ...extra,
});

const bindings: AircraftBindings = {
  aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', hasUserBindings: true },
  devices: [
    {
      kind: 'controller',
      name: 'Stick',
      guid: 'aaaaaaaa-0000-0000-0000-000000000001',
      connected: true,
      bindings: [
        binding('JOY_BTN1', 'Gun Trigger'),
        binding('JOY_BTN2', 'Weapon Release', { source: 'default' }),
        binding('JOY_BTN2', 'Undesignate'),
        binding('JOY_BTN3', 'Trim up'),
        binding('JOY_BTN3', 'Trim reset', { modifiers: ['LCtrl'] }),
        binding('JOY_X', 'Roll', { kind: 'axis' }),
      ],
    },
    { kind: 'keyboard', name: 'Keyboard', connected: true, bindings: [binding('G', 'Gear')] },
  ],
};

describe('what a control does (binding inspector)', () => {
  it('groups the bindings of a game by controller and input, and leaves the keyboard out', () => {
    const bound = boundInputsOf(reader, bindings);
    expect(bound.aircraft).toEqual({ id: 'FA-18C_hornet', name: 'F/A-18C' });
    expect(bound.controllers).toHaveLength(1);
    const stick = bound.controllers[0]!;
    expect(stick.guid).toBe('AAAAAAAA-0000-0000-0000-000000000001');
    expect(stick.route).toBe(
      '/bindings?guid=aaaaaaaa-0000-0000-0000-000000000001&aircraft=FA-18C_hornet'
    );
    expect(stick.controls.map((c) => [c.input, c.actions.length])).toEqual([
      ['JOY_BTN1', 1],
      ['JOY_BTN2', 2],
      ['JOY_BTN3', 2],
      ['JOY_X', 1],
    ]);
  });

  it('an input bound to several actions shows all of them with a duplicate warning; a modifier makes it a different press', () => {
    const bound = boundInputsOf(reader, bindings);
    const guid = 'aaaaaaaa-0000-0000-0000-000000000001';
    const twice = boundControl(bound, guid, 'JOY_BTN2')!;
    expect(twice.actions.map((a) => [a.action, a.source])).toEqual([
      ['Weapon Release', 'default'],
      ['Undesignate', 'user'],
    ]);
    expect(twice.duplicate).toBe(true);
    // Trim up, and Trim reset only with LCtrl held: two different presses, not a duplicate.
    const withModifier = boundControl(bound, guid, 'JOY_BTN3')!;
    expect(withModifier.actions).toHaveLength(2);
    expect(withModifier.duplicate).toBe(false);
    expect(boundControl(bound, guid, 'JOY_BTN1')?.duplicate).toBe(false);
    // Nothing bound, another controller, nothing chosen.
    expect(boundControl(bound, guid, 'JOY_BTN40')).toBeUndefined();
    expect(boundControl(bound, 'BBBBBBBB-0000-0000-0000-000000000002', 'JOY_BTN1')).toBeUndefined();
    expect(boundControl(undefined, guid, 'JOY_BTN1')).toBeUndefined();
  });

  it('names the control that was used the way the game does: button, hat direction, axis', () => {
    const device = { axisNames: ['X', 'Y', 'RZ'] };
    const log = new ActivityLog();
    const state = (over: Partial<InputState>): InputState => ({
      index: 0,
      name: 'Stick',
      axes: [0, 0, 0],
      buttons: [false, false, false],
      hats: [[0, 0]],
      timestamp: 1,
      ...over,
    });
    const rest = state({});
    log.record(device, 'Stick', undefined, rest, 0);
    expect(
      log.record(device, 'Stick', rest, state({ buttons: [false, false, true] }), 10)?.input
    ).toBe('JOY_BTN3');
    expect(log.record(device, 'Stick', rest, state({ hats: [[1, 1]] }), 20)?.input).toBe(
      'JOY_BTN_POV1_UR'
    );
    // Back to centre is not a control of its own.
    expect(log.record(device, 'Stick', state({ hats: [[1, 1]] }), rest, 30)?.input).toBeUndefined();
    expect(log.record(device, 'Stick', rest, state({ axes: [0, 0, 0.8] }), 2000)?.input).toBe(
      'JOY_RZ'
    );
    expect(log.lastControl).toEqual({ deviceIndex: 0, input: 'JOY_RZ' });
    // A button let go while an axis moves: the axis is what is being used, not the release.
    const held = state({ buttons: [true, false, false], axes: [0, 0, 0.8] });
    log.record(device, 'Stick', state({ axes: [0, 0, 0.8] }), held, 4000);
    expect(log.lastControl?.input).toBe('JOY_BTN1');
    const line = log.record(device, 'Stick', held, state({ axes: [0.9, 0, 0.8] }), 6000);
    expect(line?.text).toBe('Button 1 released');
    expect(log.lastControl?.input).toBe('JOY_X');
    log.record(device, 'Stick', held, state({ axes: [0, 0, 0.8] }), 8000);
    expect(log.lastControl?.input).toBe('JOY_X');
    expect(gameInputLabel('JOY_BTN12')).toBe('Button 12');
    expect(gameInputLabel('JOY_BTN_POV1_UR')).toBe('Hat 1 up-right');
    expect(gameInputLabel('JOY_RZ')).toBe('Z rotation');
    expect(gameInputLabel('JOY_SLIDER1')).toBe('Slider 1');
    expect(gameInputLabel('LShift')).toBe('LShift');
  });
});
