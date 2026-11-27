import { describe, expect, it } from 'vitest';
import type { OverviewBinding } from '../contract';
import { canChange, shownBindings } from './rows';

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
  const takes = new Map<string, 'button' | 'axis'>([
    ['5', 'button'],
    ['25', 'axis'],
    ['25:+', 'button'],
    ['25:-', 'button'],
  ]);
  const button = { kind: 'button', index: 3 } as const;
  const axis = { kind: 'axis', axis: 'X' } as const;

  it('is a button on a button action or on a side of an axis action, and a whole axis on an axis action', () => {
    expect(canChange(binding('Fire', 'Button 3', { actionId: '5', control: button }), takes)).toBe(
      true
    );
    expect(
      canChange(binding('Zoom In', 'Button 3', { actionId: '25:+', control: button }), takes)
    ).toBe(true);
    expect(
      canChange(
        binding('Zoom View', 'X axis', { actionId: '25', kind: 'axis', control: axis }),
        takes
      )
    ).toBe(true);
  });

  it('is not half an axis on a side, a key, a binding with a modifier key, another tab’s, an input RigReady does not understand, or an action it does not offer', () => {
    // Half an axis driving one side: the side takes a button.
    expect(
      canChange(
        binding('Zoom In', 'X axis', { actionId: '25:+', kind: 'axis', control: axis }),
        takes
      )
    ).toBe(false);
    expect(canChange(binding('Fire', 'Space', { actionId: '5', kind: 'key' }), takes)).toBe(false);
    expect(
      canChange(
        binding('Fire', 'Button 3', { actionId: '5', control: button, modifiers: ['Ctrl'] }),
        takes
      )
    ).toBe(false);
    expect(
      canChange(
        binding('Fire', 'Button 3', { actionId: '5', control: button, mapCategory: 'Chat' }),
        takes
      )
    ).toBe(false);
    // An axis past the ones the controller reports has no control.
    expect(canChange(binding('Zoom View', 'Axis 4', { actionId: '25', kind: 'axis' }), takes)).toBe(
      false
    );
    expect(canChange(binding('New', 'Button 3', { actionId: '99', control: button }), takes)).toBe(
      false
    );
  });
});
