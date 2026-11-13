import { describe, expect, it } from 'vitest';
import type { PressRow } from './model';
import {
  alive,
  anchorOf,
  namedPlace,
  NAMED_PLACES,
  nextEnd,
  rowWords,
  takeRows,
  type ShownRow,
} from './shown';

const row = (over: Partial<PressRow> = {}): PressRow => ({
  id: 1,
  count: 1,
  stamp: 50_000,
  ageMs: 0,
  control: 'Button 5',
  device: 'Stick',
  actions: [{ action: 'Weapon release', modifiers: [] }],
  known: true,
  ...over,
});

describe('the lines a window has, by its own clock', () => {
  it('a line that is new to the window is as old as it was sent', () => {
    // The window's clock says 9000 while the main side stamped the press at 50000.
    const shown = takeRows([], [row({ ageMs: 1200 })], 9000);
    expect(shown).toEqual([
      { row: row({ ageMs: 1200 }), key: '1:50000', pressedAt: 7800, startAgeMs: 1200 },
    ]);
  });

  it('sent again with the next press, a line keeps its moment: it does not fade twice as fast', () => {
    const first = takeRows([], [row()], 9000);
    // Two seconds later another control is pressed, and both lines are sent.
    const both = takeRows(
      first,
      [row({ id: 2, stamp: 52_000, control: 'Button 9' }), row({ ageMs: 2000 })],
      11_000
    );
    expect(both.map((s) => [s.key, s.pressedAt, s.startAgeMs])).toEqual([
      ['2:52000', 11_000, 0],
      ['1:50000', 9000, 0],
    ]);
    // What the line says is what was sent last.
    expect(both[1]!.row.ageMs).toBe(2000);
  });

  it('pressed again, the same control is a new line in the same spot: its fading starts over', () => {
    const first = takeRows([], [row()], 9000);
    const again = takeRows(first, [row({ stamp: 53_000, count: 2 })], 12_000);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ key: '1:53000', pressedAt: 12_000, startAgeMs: 0 });
    expect(again[0]!.row.count).toBe(2);
  });

  it('a line is over when its time is up, to the millisecond', () => {
    const shown = takeRows([], [row(), row({ id: 2, stamp: 49_000, ageMs: 1000 })], 9000);
    expect(alive(shown, 5000, 12_999).map((s) => s.row.id)).toEqual([1, 2]);
    expect(alive(shown, 5000, 13_000).map((s) => s.row.id)).toEqual([1]);
    expect(alive(shown, 5000, 14_000)).toEqual([]);
    // A shorter life set on the page takes effect on what is shown.
    expect(alive(shown, 2000, 10_500).map((s) => s.row.id)).toEqual([1]);
  });

  it('says how long until the first line is over, and nothing when there is none', () => {
    const shown = takeRows([], [row(), row({ id: 2, stamp: 49_000, ageMs: 1000 })], 9000);
    expect(nextEnd(shown, 5000, 9000)).toBe(4000);
    expect(nextEnd(shown, 5000, 12_500)).toBe(500);
    // Already over (a timer that ran late): now.
    expect(nextEnd(shown, 5000, 20_000)).toBe(0);
    expect(nextEnd([], 5000, 9000)).toBeUndefined();
    const none: ShownRow[] = alive(shown, 5000, 20_000);
    expect(nextEnd(none, 5000, 20_000)).toBeUndefined();
  });
});

describe('what a line says', () => {
  it('the action large, the control and the controller small', () => {
    expect(rowWords(row())).toEqual({
      main: 'Weapon release',
      held: [],
      more: 0,
      sub: 'Button 5 · Stick',
      quiet: false,
    });
  });

  it('with more than one action on the control: the first, what it needs held, and how many more', () => {
    const words = rowWords(
      row({
        actions: [
          { action: 'Trim up', modifiers: ['Button 3'] },
          { action: 'View up', modifiers: [] },
          { action: 'Zoom in', modifiers: [] },
        ],
      })
    );
    expect(words).toMatchObject({ main: 'Trim up', held: ['Button 3'], more: 2, quiet: false });
  });

  it('a press the game has nothing on says so, quietly', () => {
    expect(rowWords(row({ actions: [] }))).toEqual({
      main: 'Not bound',
      held: [],
      more: 0,
      sub: 'Button 5 · Stick',
      quiet: true,
    });
  });

  it('when the bindings could not be read it does not claim that nothing is bound', () => {
    expect(rowWords(row({ actions: [], known: false }))).toEqual({
      main: 'Button 5',
      held: [],
      more: 0,
      sub: 'Stick',
      quiet: false,
    });
  });
});

describe('where the list hangs', () => {
  it('from the top in the upper half of the screen, from the bottom in the lower', () => {
    expect(anchorOf({ x: 0.5, y: 0 }).edge).toBe('top');
    expect(anchorOf({ x: 0.5, y: 0.49 }).edge).toBe('top');
    expect(anchorOf({ x: 0.5, y: 0.5 }).edge).toBe('bottom');
    expect(anchorOf({ x: 0.5, y: 1 }).edge).toBe('bottom');
  });

  it('set to the side of the screen it is on', () => {
    expect(anchorOf({ x: 0, y: 1 }).side).toBe('left');
    expect(anchorOf({ x: 0.3, y: 1 }).side).toBe('left');
    expect(anchorOf({ x: 0.5, y: 1 }).side).toBe('middle');
    expect(anchorOf({ x: 0.7, y: 1 }).side).toBe('right');
    expect(anchorOf({ x: 1, y: 1 }).side).toBe('right');
  });

  it('nine places have a name; one that was dragged to has none', () => {
    expect(NAMED_PLACES).toHaveLength(9);
    expect(new Set(NAMED_PLACES.map((p) => p.label)).size).toBe(9);
    expect(new Set(NAMED_PLACES.map((p) => `${p.at.x}/${p.at.y}`)).size).toBe(9);
    expect(namedPlace({ x: 0.5, y: 1 })).toBe('Bottom middle');
    expect(namedPlace({ x: 1, y: 0 })).toBe('Top right');
    expect(namedPlace({ x: 0.26882, y: 0.27624 })).toBeUndefined();
  });
});
