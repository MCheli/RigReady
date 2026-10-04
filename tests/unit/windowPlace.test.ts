/**
 * Where a panel window (the cheat-sheet pop-out) was left, and whether that place is still
 * on a screen: the monitor layout of this rig changes between flying and the desk.
 */
import { describe, expect, it } from 'vitest';
import { panelPlaces, placeOnScreens, withPanelPlace } from '../../src/core/windowPlace';

const MIN = { width: 320, height: 240 };
const DESK = [
  { x: 0, y: 0, width: 2560, height: 1400 },
  { x: 2560, y: 0, width: 5120, height: 1400 },
];

describe('the remembered place of a panel window', () => {
  it('is kept per panel in one small file, and read back', () => {
    const first = withPanelPlace(undefined, 'cheat-sheets-quick', {
      x: 160,
      y: 120,
      width: 720,
      height: 800,
    });
    expect(panelPlaces(first)).toEqual({
      'cheat-sheets-quick': { x: 160, y: 120, width: 720, height: 800 },
    });
    // Another panel is added beside it; moving the first one again replaces only its place.
    const second = withPanelPlace(first, 'other', { x: 0, y: 0, width: 400, height: 300 });
    const moved = withPanelPlace(second, 'cheat-sheets-quick', {
      x: 3000,
      y: 40,
      width: 560,
      height: 640,
    });
    expect(panelPlaces(moved)).toEqual({
      'cheat-sheets-quick': { x: 3000, y: 40, width: 560, height: 640 },
      other: { x: 0, y: 0, width: 400, height: 300 },
    });
  });

  it('is nothing for a file that is missing, damaged or holds something else', () => {
    expect(panelPlaces(undefined)).toEqual({});
    expect(panelPlaces('{ not json')).toEqual({});
    expect(panelPlaces('[1, 2]')).toEqual({});
    expect(panelPlaces('{"panels": 3}')).toEqual({});
    // An entry that is not a place is left out; the others are kept.
    expect(
      panelPlaces(
        JSON.stringify({
          panels: {
            good: { x: 1, y: 2, width: 300, height: 200 },
            half: { x: 1, y: 2 },
            text: 'left',
            huge: { x: 0, y: 0, width: 1e9, height: 10 },
            fraction: { x: 0.5, y: 0, width: 300, height: 200 },
          },
        })
      )
    ).toEqual({ good: { x: 1, y: 2, width: 300, height: 200 } });
    // A damaged file is replaced by a good one on the next move.
    expect(
      panelPlaces(withPanelPlace('{ not json', 'a', { x: 5, y: 6, width: 400, height: 300 }))
    ).toEqual({ a: { x: 5, y: 6, width: 400, height: 300 } });
  });

  it('is used again while it is on a connected screen', () => {
    const onTheUltrawide = { x: 3000, y: 40, width: 700, height: 780 };
    expect(placeOnScreens(onTheUltrawide, DESK, MIN)).toEqual(onTheUltrawide);
    // Hanging over the edge is fine while the top edge can be seen and grabbed.
    const overTheEdge = { x: -400, y: 0, width: 700, height: 780 };
    expect(placeOnScreens(overTheEdge, DESK, MIN)).toEqual(overTheEdge);
    expect(placeOnScreens(undefined, DESK, MIN)).toBeUndefined();
  });

  it('keeps only the size when the screen it was on is gone, so the window opens where one is', () => {
    const flying = [{ x: 0, y: 0, width: 5120, height: 1400 }];
    // It was on a monitor to the right that is off now.
    expect(placeOnScreens({ x: 6000, y: 100, width: 700, height: 780 }, flying, MIN)).toEqual({
      width: 700,
      height: 780,
    });
    // Its title bar above every screen, or only a sliver of it on one: not a place to open at.
    expect(placeOnScreens({ x: 100, y: -300, width: 700, height: 780 }, flying, MIN)).toEqual({
      width: 700,
      height: 780,
    });
    expect(placeOnScreens({ x: 5100, y: 100, width: 700, height: 780 }, flying, MIN)).toEqual({
      width: 700,
      height: 780,
    });
    expect(placeOnScreens({ x: 100, y: 1380, width: 700, height: 780 }, flying, MIN)).toEqual({
      width: 700,
      height: 780,
    });
    expect(placeOnScreens({ x: 100, y: 100, width: 700, height: 780 }, [], MIN)).toEqual({
      width: 700,
      height: 780,
    });
  });

  it('never opens a window smaller than it may be made', () => {
    expect(placeOnScreens({ x: 10, y: 10, width: 40, height: 30 }, DESK, MIN)).toEqual({
      x: 10,
      y: 10,
      width: 320,
      height: 240,
    });
  });
});
