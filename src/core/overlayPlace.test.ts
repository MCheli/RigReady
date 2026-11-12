import { describe, expect, it } from 'vitest';
import { panelAt, panelBox, screenOf } from './overlayPlace';

const main = { x: 0, y: 0, width: 3440, height: 1440 };
/** A small portrait screen to the left of the main one, lower on the desk. */
const side = { x: -768, y: 200, width: 768, height: 1024 };
const size = { width: 400, height: 300 };

describe('where an overlay panel sits on a screen', () => {
  it('a place is a share of the free room: corners, the middle, and a screen that does not start at zero', () => {
    expect(panelBox(main, size, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(panelBox(main, size, { x: 1, y: 1 })).toEqual({
      x: 3040,
      y: 1140,
      width: 400,
      height: 300,
    });
    expect(panelBox(main, size, { x: 0.5, y: 0.5 })).toEqual({
      x: 1520,
      y: 570,
      width: 400,
      height: 300,
    });
    expect(panelBox(side, size, { x: 1, y: 0 })).toEqual({
      x: -400,
      y: 200,
      width: 400,
      height: 300,
    });
  });

  it('never leaves the screen: a place outside 0..1 is the edge, and a panel too large is made to fit', () => {
    expect(panelBox(main, size, { x: -3, y: 7 })).toEqual({
      x: 0,
      y: 1140,
      width: 400,
      height: 300,
    });
    expect(panelBox(side, { width: 2000, height: 300 }, { x: 0.3, y: 1 })).toEqual({
      x: -768,
      y: 924,
      width: 768,
      height: 300,
    });
    // A place that is no number at all (a damaged file) is the middle.
    expect(panelBox(main, size, { x: Number.NaN, y: 0 }).x).toBe(1520);
  });

  it('reads a place back from where the box is, the same place it was put at', () => {
    for (const at of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.25, y: 0.8 },
      { x: 0.5, y: 0.5 },
    ]) {
      expect(panelAt(main, panelBox(main, size, at))).toEqual(at);
      expect(panelAt(side, panelBox(side, size, at))).toEqual(at);
    }
  });

  it('a box dragged over an edge counts as at that edge; one that fills the screen is in the middle', () => {
    expect(panelAt(main, { x: -120, y: 1300, width: 400, height: 300 })).toEqual({ x: 0, y: 1 });
    expect(panelAt(side, { x: -768, y: 500, width: 768, height: 300 })).toEqual({
      x: 0.5,
      y: 0.414,
    });
  });

  it('the same place lands in the same corner of a screen of another size', () => {
    const at = panelAt(main, { x: 3040, y: 0, width: 400, height: 300 });
    expect(at).toEqual({ x: 1, y: 0 });
    expect(panelBox(side, size, at)).toEqual({ x: -400, y: 200, width: 400, height: 300 });
  });
});

describe('which screen a box is on', () => {
  it('the one its middle is inside', () => {
    expect(screenOf([main, side], { x: 100, y: 100, width: 400, height: 300 })).toBe(main);
    expect(screenOf([main, side], { x: -500, y: 600, width: 400, height: 300 })).toBe(side);
    // Hanging over the border between two screens: where most of it is.
    expect(screenOf([main, side], { x: -150, y: 600, width: 400, height: 300 })).toBe(main);
  });

  it('with its middle on no screen, the one it covers most of; touching none, no screen', () => {
    // The side screen starts lower than the main one: this box sticks out above it.
    expect(screenOf([main, side], { x: -700, y: 40, width: 300, height: 300 })).toBe(side);
    expect(screenOf([main, side], { x: 9000, y: 9000, width: 400, height: 300 })).toBeUndefined();
    expect(screenOf([], { x: 0, y: 0, width: 10, height: 10 })).toBeUndefined();
  });
});
