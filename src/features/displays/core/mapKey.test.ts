import { describe, expect, it } from 'vitest';
import { frameWidth, mapKey, nameFits, NAME_PADDING, textWidth, type KeyBox } from './mapKey';

const box = (
  id: string,
  label: string,
  left: number,
  width: number,
  extra: Partial<KeyBox> = {}
): KeyBox => ({ id, label, left, top: 0, width, ...extra });

describe('names on a drawing of the monitors', () => {
  it('fit when the box is as wide as the name and its padding, and not when it is narrower', () => {
    const needed = textWidth('MFD centre', 12) + NAME_PADDING;
    expect(nameFits('MFD centre', needed, 12)).toBe(true);
    expect(nameFits('MFD centre', needed - 1, 12)).toBe(false);
    // A smaller font needs less room.
    expect(nameFits('MFD centre', needed - 1, 11)).toBe(true);
  });

  it('gives no key when every name fits', () => {
    expect(mapKey([box('a', 'Dell', 0, 200), box('b', 'Samsung', 200, 400)], 12)).toEqual([]);
  });

  it('marks each box whose name does not fit with a letter, from left to right, and keeps the names that fit', () => {
    // The owner's Flying layout drawn small: the ultrawide has room, the three MFD
    // screens do not. They were saved as centre, right, left; the letters follow the desk.
    const key = mapKey(
      [
        box('wide', 'LC49G95T', 0, 220),
        box('centre', 'MFD centre', 253, 33),
        box('right', 'MFD right', 286, 33),
        box('left', 'MFD left', 220, 33),
      ],
      12
    );
    expect(key).toEqual([
      { id: 'left', mark: 'A', label: 'MFD left', lettered: true },
      { id: 'centre', mark: 'B', label: 'MFD centre', lettered: true },
      { id: 'right', mark: 'C', label: 'MFD right', lettered: true },
    ]);
  });

  it('orders boxes that stand above each other from top to bottom', () => {
    const key = mapKey(
      [
        box('low', 'Lower screen', 0, 20, { top: 50 }),
        box('high', 'Upper screen', 0, 20, { top: 0 }),
      ],
      12
    );
    expect(key.map((k) => `${k.mark} ${k.label}`)).toEqual(['A Upper screen', 'B Lower screen']);
  });

  it('uses the number a box already shows as its mark, and does not spend a letter on it', () => {
    const key = mapKey(
      [
        box('a', 'USB_Monitor (1 of 3)', 0, 30, { number: 3 }),
        box('b', 'USB_Monitor (2 of 3)', 30, 30),
        box('c', 'USB_Monitor (3 of 3)', 60, 30, { number: 5 }),
      ],
      12
    );
    expect(key).toEqual([
      { id: 'a', mark: '3', label: 'USB_Monitor (1 of 3)', lettered: false },
      { id: 'b', mark: 'A', label: 'USB_Monitor (2 of 3)', lettered: true },
      { id: 'c', mark: '5', label: 'USB_Monitor (3 of 3)', lettered: false },
    ]);
  });

  it('goes on with numbers when there are more boxes than letters', () => {
    const many = Array.from({ length: 28 }, (_, i) => box(`m${i}`, `Monitor ${i}`, i * 10, 10));
    const marks = mapKey(many, 12).map((k) => k.mark);
    expect(marks.slice(0, 2)).toEqual(['A', 'B']);
    expect(marks.slice(25)).toEqual(['Z', '27', '28']);
  });
});

describe('how wide a drawing is', () => {
  it('fills the room it has, but is never taller than allowed', () => {
    // A wide desk (ratio 0.2): the room is the limit.
    expect(frameWidth(600, 200, 0.2)).toBe(600);
    // A tall arrangement (ratio 1): the height is the limit.
    expect(frameWidth(600, 200, 1)).toBe(200);
  });

  it('assumes the widest it can be before the room is measured', () => {
    expect(frameWidth(undefined, 200, 0.5)).toBe(400);
    expect(frameWidth(0, 200, 0.5)).toBe(400);
  });

  it('has no width to give when nothing is drawn and no room is known', () => {
    expect(frameWidth(undefined, 200, 0)).toBe(0);
    expect(frameWidth(300, 200, 0)).toBe(300);
  });
});
