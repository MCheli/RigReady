import { describe, expect, it } from 'vitest';
import type { Action } from '../contract';
import { shownActions, type RowFilter } from './rows';

const action = (id: string, patch: Partial<Action> = {}): Action => ({
  id,
  name: id,
  group: 'Driving',
  accepts: ['button', 'key'],
  differs: false,
  ...patch,
});
const ALL: RowFilter = { text: '', onlyUnbound: false, onlyDiffers: false, device: '' };
const ids = (actions: Action[]): string[] => actions.map((a) => a.id);

describe('the rows the iRacing bindings page lists', () => {
  const button = {
    kind: 'button' as const,
    device: 'WHEEL',
    deviceName: 'Wheel',
    input: 'Button 7',
  };
  const before = [
    action('HeadlightFlash'),
    action('Starter', { binding: button }),
    action('Gear1'),
  ];

  it('filters by search, not bound, differs and device', () => {
    expect(ids(shownActions(before, ALL))).toEqual(['HeadlightFlash', 'Starter', 'Gear1']);
    expect(ids(shownActions(before, { ...ALL, onlyUnbound: true }))).toEqual([
      'HeadlightFlash',
      'Gear1',
    ]);
    expect(ids(shownActions(before, { ...ALL, device: 'WHEEL' }))).toEqual(['Starter']);
    expect(ids(shownActions(before, { ...ALL, text: ' button 7 ' }))).toEqual(['Starter']);
    expect(ids(shownActions(before, { ...ALL, onlyDiffers: true }))).toEqual([]);
  });

  it('keeps a row just saved in sight under "Not bound", with its new binding', () => {
    // The user had "Not bound" on and bound Flash headlights to a button: without `keep`
    // the row would vanish the moment it is saved.
    const after = [action('HeadlightFlash', { binding: button }), ...before.slice(1)];
    const filter = { ...ALL, onlyUnbound: true };
    expect(ids(shownActions(after, filter))).toEqual(['Gear1']);
    const shown = shownActions(after, filter, 'HeadlightFlash');
    expect(ids(shown)).toEqual(['HeadlightFlash', 'Gear1']);
    expect(shown[0]!.binding?.input).toBe('Button 7');
    // Under a search or a device filter that no longer finds it, too.
    expect(ids(shownActions(after, { ...ALL, text: 'gear' }, 'HeadlightFlash'))).toEqual([
      'HeadlightFlash',
      'Gear1',
    ]);
    // Nothing else slips through with it.
    expect(ids(shownActions(after, { ...ALL, device: 'NONE' }, 'HeadlightFlash'))).toEqual([
      'HeadlightFlash',
    ]);
  });
});
