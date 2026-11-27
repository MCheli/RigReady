import { describe, expect, it } from 'vitest';
import type { OverviewBinding } from '../contract';
import { shownBindings } from './rows';

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
