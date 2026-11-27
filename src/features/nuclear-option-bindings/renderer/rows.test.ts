import { describe, expect, it } from 'vitest';
import type { OverviewBinding } from '../contract';
import { actionRows, canChange, gameActionCount, shownBindings } from './rows';

const binding = (
  action: string,
  inputLabel: string,
  extra: Partial<OverviewBinding> = {}
): OverviewBinding => ({
  actionId: action,
  action,
  category: 'Flight Controls',
  mapCategory: 'Game',
  input: inputLabel,
  inputLabel,
  kind: 'button',
  modifiers: [],
  inverted: false,
  ...extra,
});

describe('the bindings a search leaves', () => {
  const all = [
    binding('Fire', 'Button 1'),
    binding('Toggle Gear', 'Button 18'),
    binding('Eject', 'E', { kind: 'key', modifiers: ['Ctrl', 'Shift'] }),
    binding('Center View', 'Button 3', { category: 'Camera Controls' }),
  ];

  it('is everything when nothing is typed, or the field was cleared', () => {
    expect(shownBindings(all, '')).toBe(all);
    expect(shownBindings(all, '   ')).toBe(all);
    expect(shownBindings(all, null)).toBe(all);
  });

  it('matches every word against the action, its group, the input and the modifier keys', () => {
    expect(shownBindings(all, 'gear').map((b) => b.action)).toEqual(['Toggle Gear']);
    expect(shownBindings(all, 'BUTTON 1').map((b) => b.action)).toEqual(['Fire', 'Toggle Gear']);
    expect(shownBindings(all, 'camera').map((b) => b.action)).toEqual(['Center View']);
    expect(shownBindings(all, 'shift eject').map((b) => b.action)).toEqual(['Eject']);
    expect(shownBindings(all, 'flaps')).toEqual([]);
  });
});

describe('a binding the page can change', () => {
  const offered = new Map<string, { takes: 'button' | 'axis'; mapCategory: string }>([
    ['5', { takes: 'button', mapCategory: 'Game' }],
    ['25', { takes: 'axis', mapCategory: 'Game' }],
    ['25:+', { takes: 'button', mapCategory: 'Game' }],
    ['25:-', { takes: 'button', mapCategory: 'Game' }],
    ['34', { takes: 'button', mapCategory: 'Chat' }],
  ]);
  const button = { kind: 'button', index: 3 } as const;
  const axis = { kind: 'axis', axis: 'X' } as const;
  const space = { code: 'Space', ctrl: false, alt: false, shift: false };

  it('is a key RigReady can number, on what takes a button, in the tab that action is saved under, whatever is held with it', () => {
    expect(
      canChange(binding('Fire', 'Space', { actionId: '5', kind: 'key', key: space }), offered)
    ).toBe(true);
    expect(
      canChange(
        binding('Zoom In', 'E', {
          actionId: '25:+',
          kind: 'key',
          modifiers: ['Ctrl'],
          key: { code: 'KeyE', ctrl: true, alt: false, shift: false },
        }),
        offered
      )
    ).toBe(true);
    expect(
      canChange(
        binding('Submit Chat', 'Enter', {
          actionId: '34',
          kind: 'key',
          mapCategory: 'Chat',
          key: { code: 'Enter', ctrl: false, alt: false, shift: false },
        }),
        offered
      )
    ).toBe(true);
  });

  it('is a button on a button action or on a side of an axis action, and a whole axis on an axis action', () => {
    expect(
      canChange(binding('Fire', 'Button 3', { actionId: '5', control: button }), offered)
    ).toBe(true);
    expect(
      canChange(binding('Zoom In', 'Button 3', { actionId: '25:+', control: button }), offered)
    ).toBe(true);
    expect(
      canChange(
        binding('Zoom View', 'X axis', { actionId: '25', kind: 'axis', control: axis }),
        offered
      )
    ).toBe(true);
  });

  it('is not a key in another tab than its action’s, a key RigReady cannot number, a key on a whole axis, half an axis on a side, a button with a modifier key or in another tab, an input it does not understand, or an action it does not offer', () => {
    // A Game action's key found in the Chat tab: a change would go into the Game tab's map.
    expect(
      canChange(
        binding('Fire', 'Space', { actionId: '5', kind: 'key', mapCategory: 'Chat', key: space }),
        offered
      )
    ).toBe(false);
    // No `key`: the overview could not say which of the game's keys this is.
    expect(canChange(binding('Fire', 'Key 999', { actionId: '5', kind: 'key' }), offered)).toBe(
      false
    );
    expect(
      canChange(binding('Zoom View', 'Z', { actionId: '25', kind: 'key', key: space }), offered)
    ).toBe(false);
    // Half an axis driving one side: the side takes a button.
    expect(
      canChange(
        binding('Zoom In', 'X axis', { actionId: '25:+', kind: 'axis', control: axis }),
        offered
      )
    ).toBe(false);
    expect(
      canChange(
        binding('Fire', 'Button 3', { actionId: '5', control: button, modifiers: ['Ctrl'] }),
        offered
      )
    ).toBe(false);
    expect(
      canChange(
        binding('Fire', 'Button 3', { actionId: '5', control: button, mapCategory: 'Chat' }),
        offered
      )
    ).toBe(false);
    // An axis past the ones the controller reports has no control.
    expect(
      canChange(binding('Zoom View', 'Axis 4', { actionId: '25', kind: 'axis' }), offered)
    ).toBe(false);
    expect(
      canChange(binding('New', 'Button 3', { actionId: '99', control: button }), offered)
    ).toBe(false);
  });
});

describe('every action with where it is bound', () => {
  const device = (
    id: string,
    name: string,
    kind: 'controller' | 'keyboard' | 'mouse',
    bindings: OverviewBinding[],
    connected = true
  ) => ({ id, name, kind, connected, bindings });
  const action = (key: string, name: string, category = 'Flight Controls') => ({
    id: Number(key.split(':')[0]),
    key,
    name,
    category,
    mapCategory: 'Game',
    takes: 'button' as const,
  });
  const overview = {
    actions: [
      action('5', 'Fire'),
      action('0', 'Pitch Axis'),
      action('25:+', 'Zoom In', 'Camera Controls'),
      action('49', 'Toggle Navigation Lights', 'Gameplay'),
    ],
    devices: [
      device('c1', 'Stick', 'controller', [
        binding('5', 'Button 1'),
        binding('0', 'Y axis', { kind: 'axis', inverted: true }),
      ]),
      device(
        'c2',
        'Panel',
        'controller',
        [binding('5', 'Button 1'), binding('0', 'X axis')],
        false
      ),
      device('keyboard', 'Keyboard', 'keyboard', [
        binding('5', 'Space', { kind: 'key' }),
        binding('25:+', 'E', { kind: 'key', modifiers: ['Ctrl'] }),
      ]),
    ],
  };

  it('lists every action, bound or not, with each place in the page’s words, and counts the controllers', () => {
    const rows = actionRows(overview, '');
    expect(
      rows.map((r) => [r.name, r.controllers, r.places.map((p) => `${p.deviceName}: ${p.input}`)])
    ).toEqual([
      ['Fire', 2, ['Stick: Button 1', 'Panel: Button 1', 'Keyboard: Space']],
      ['Pitch Axis', 2, ['Stick: Y axis · reversed', 'Panel: X axis']],
      ['Zoom In', 0, ['Keyboard: Ctrl + E']],
      ['Toggle Navigation Lights', 0, []],
    ]);
    expect(rows[0]!.places[1]).toMatchObject({
      deviceId: 'c2',
      kind: 'controller',
      connected: false,
    });
  });

  it('a search looks in the action, its group, the devices and the inputs; "several" leaves what is on more than one controller', () => {
    expect(actionRows(overview, 'panel').map((r) => r.name)).toEqual(['Fire', 'Pitch Axis']);
    expect(actionRows(overview, 'camera').map((r) => r.name)).toEqual(['Zoom In']);
    expect(actionRows(overview, 'ctrl e').map((r) => r.name)).toEqual(['Zoom In']);
    expect(actionRows(overview, 'lights').map((r) => r.name)).toEqual(['Toggle Navigation Lights']);
    expect(actionRows(overview, null, true).map((r) => r.name)).toEqual(['Fire', 'Pitch Axis']);
    expect(actionRows(overview, 'axis', true).map((r) => r.name)).toEqual(['Pitch Axis']);
    expect(actionRows(overview, 'nothing like it')).toEqual([]);
  });

  it('an axis and its sides count together: the pedals’ brake axis and a button for the brake on the throttle are two controllers', () => {
    const brakes = {
      actions: [action('6', 'Brake Axis'), action('6:+', 'Apply Brakes'), action('5', 'Fire')],
      devices: [
        device('pedals', 'Pedals', 'controller', [binding('6', 'Z axis', { kind: 'axis' })]),
        device('throttle', 'Throttle', 'controller', [
          binding('6:+', 'Button 3'),
          binding('5', 'Button 1'),
        ]),
      ],
    };
    const rows = actionRows(brakes, '');
    expect(rows.map((r) => [r.name, r.controllers, r.withFamily])).toEqual([
      ['Brake Axis', 2, true],
      ['Apply Brakes', 2, true],
      ['Fire', 1, false],
    ]);
    // Both rows stay under "several", and they are one action of the game.
    const several = actionRows(brakes, '', true);
    expect(several.map((r) => r.name)).toEqual(['Brake Axis', 'Apply Brakes']);
    expect(gameActionCount(several)).toBe(1);
    expect(gameActionCount(rows)).toBe(2);
  });

  it('what is bound to an action RigReady has no name for is listed under the name its bindings carry', () => {
    const later = {
      actions: [action('5', 'Fire')],
      devices: [
        device('c1', 'Stick', 'controller', [
          binding('99', 'Button 9', { action: 'Action 99', category: 'Not known to RigReady' }),
        ]),
        device('c2', 'Panel', 'controller', [
          binding('99', 'Button 2', { action: 'Action 99', category: 'Not known to RigReady' }),
        ]),
      ],
    };
    expect(
      actionRows(later, '').map((r) => [r.name, r.category, r.controllers, r.places.length])
    ).toEqual([
      ['Fire', 'Flight Controls', 0, 0],
      ['Action 99', 'Not known to RigReady', 2, 2],
    ]);
    expect(actionRows(later, '', true).map((r) => r.name)).toEqual(['Action 99']);
  });
});
