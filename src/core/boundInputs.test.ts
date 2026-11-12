import { describe, expect, it } from 'vitest';
import {
  controlFromDirectInput,
  controlLabel,
  type AircraftBindings,
  type BoundInput,
} from './bindings';
import { boundControl, boundInputsOf } from './boundInputs';

/** "Button 12" for JOY_BTN12; the name itself for an input that is not a control. */
const gameInputLabel = (input: string): string => {
  const control = controlFromDirectInput(input);
  return control ? controlLabel(control) : input;
};

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

  it('finds a binding by the control it is on, whatever the game calls its input (the racing games)', () => {
    const guid = 'cccccccc-0000-0000-0000-000000000003';
    const racing: AircraftBindings = {
      aircraft: { id: 'all', name: 'All cars', hasUserBindings: true, general: true },
      devices: [
        {
          kind: 'controller',
          name: 'Wheel',
          guid,
          connected: true,
          bindings: [
            // iRacing counts buttons from 0, Le Mans Ultimate numbers every input, ...
            binding('button 4', 'Shift up', {
              inputLabel: 'Button 5',
              control: { kind: 'button', index: 5 },
            }),
            binding('id 16', 'Pit Menu Up', {
              inputLabel: 'Hat 1 up',
              kind: 'hat',
              control: { kind: 'hat', hat: 1, direction: 'U' },
            }),
            binding('axis 0', 'Steering', {
              inputLabel: 'Steering',
              kind: 'axis',
              control: { kind: 'axis', axis: 'X' },
            }),
            // An input the reader could not place on a control keeps the game's own name.
            binding('axis 9', 'Something else', { kind: 'axis' }),
          ],
        },
      ],
    };
    const bound = boundInputsOf({ ...reader, game: 'iracing', gameName: 'iRacing' }, racing);
    // One set for every car: it is spoken of by the game's name.
    expect(bound.aircraft).toEqual({ id: 'all', name: 'iRacing' });
    expect(bound.controllers[0]!.controls.map((c) => c.input)).toEqual([
      'JOY_BTN5',
      'JOY_BTN_POV1_U',
      'JOY_X',
      'axis 9',
    ]);
    // Press detection says JOY_BTN5: that is the paddle, and it shifts up.
    expect(boundControl(bound, guid, 'JOY_BTN5')).toMatchObject({
      label: 'Button 5',
      actions: [{ action: 'Shift up' }],
    });
    expect(boundControl(bound, guid, 'JOY_BTN_POV1_U')?.actions[0]?.action).toBe('Pit Menu Up');
    expect(boundControl(bound, guid, 'JOY_X')?.actions[0]?.action).toBe('Steering');
    expect(boundControl(bound, guid, 'JOY_BTN4')).toBeUndefined();
  });
});
