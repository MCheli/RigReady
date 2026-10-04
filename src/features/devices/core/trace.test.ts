import { describe, expect, it } from 'vitest';
import {
  AxisHistory,
  HAT_POINTS,
  HOLD_GAP_MS,
  stickPairs,
  stripLayout,
  tracePoints,
  trailPoints,
} from './trace';

/** x,y pairs as a list of points, rounded so the numbers read as pixels. */
const points = (flat: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([Math.round(flat[i]!), Math.round(flat[i + 1]!)]);
  }
  return out;
};

describe('the record behind the tester’s traces', () => {
  it('keeps the newest samples and forgets the oldest once it is full', () => {
    const history = new AxisHistory(2, 4);
    expect(history.length).toBe(0);
    expect(history.latest).toBe(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < 6; i++) history.push(i * 10, [i / 10, -i / 10]);
    expect(history.length).toBe(4);
    expect(history.time(0)).toBe(20);
    expect(history.latest).toBe(50);
    expect(history.value(0, 0)).toBeCloseTo(0.2);
    expect(history.value(3, 1)).toBeCloseTo(-0.5);
  });

  it('holds what a controller reports to the travel of an axis, and a missing axis at the centre', () => {
    const history = new AxisHistory(3);
    history.push(0, [7, Number.NaN]);
    expect(history.value(0, 0)).toBe(1);
    expect(history.value(0, 1)).toBe(0);
    expect(history.value(0, 2)).toBe(0);
    expect(history.value(0, 9)).toBe(0);
  });

  it('knows when each axis last moved; the first sample is where it rests, not a movement', () => {
    const history = new AxisHistory(2);
    history.push(100, [0.5, 0]);
    expect(history.lastChange(0)).toBe(Number.NEGATIVE_INFINITY);
    history.push(200, [0.5, 0.25]);
    history.push(300, [0.5, 0.25]);
    expect(history.lastChange(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(history.lastChange(1)).toBe(200);
    expect(history.lastChange(7)).toBe(Number.NEGATIVE_INFINITY);
    expect(history.lastChangeOf([0, 1])).toBe(200);
    expect(history.lastChangeOf([])).toBe(Number.NEGATIVE_INFINITY);
  });

  it('starts a window at the sample before it, so the line comes in from the left edge', () => {
    const history = new AxisHistory(1);
    for (const t of [0, 100, 200, 300]) history.push(t, [t / 300]);
    expect(history.from(150)).toBe(1);
    expect(history.from(100)).toBe(0);
    expect(history.from(-50)).toBe(0);
    expect(history.from(900)).toBe(3);
  });
});

describe('an axis trace', () => {
  it('is nothing before the controller has reported', () => {
    expect(tracePoints(new AxisHistory(1), 0, 1000, 6000, 600, 40)).toEqual([]);
  });

  it('is a flat line across the whole strip for an axis that stands still', () => {
    const history = new AxisHistory(1);
    history.push(0, [0]);
    // Long after the only sample: the value still holds, from the left edge to the right.
    expect(points(tracePoints(history, 0, 60_000, 6000, 600, 40))).toEqual([
      [0, 20],
      [600, 20],
    ]);
  });

  it('puts full travel at the top and none at the bottom, inside the padding', () => {
    const history = new AxisHistory(2);
    history.push(0, [1, -1]);
    expect(points(tracePoints(history, 0, 6000, 6000, 600, 40, 4))[0]).toEqual([0, 4]);
    expect(points(tracePoints(history, 1, 6000, 6000, 600, 40, 4))[0]).toEqual([0, 36]);
  });

  it('holds and then steps when the axis jumped after standing still', () => {
    const history = new AxisHistory(1);
    history.push(0, [-1]);
    history.push(3000, [1]);
    // 6 s across 600 px: the jump is at 3 s, in the middle, and the new value runs on to now.
    expect(points(tracePoints(history, 0, 6000, 6000, 600, 40))).toEqual([
      [0, 40],
      [300, 40],
      [300, 0],
      [600, 0],
    ]);
  });

  it('joins the samples of one continuous movement with straight lines', () => {
    const history = new AxisHistory(1);
    const step = HOLD_GAP_MS / 2;
    history.push(0, [-1]);
    history.push(step, [0]);
    history.push(2 * step, [1]);
    const line = points(tracePoints(history, 0, 2 * step, 600, 600, 40));
    // At rest from the left edge, then one straight line per sample: no flat-then-step.
    expect(line).toEqual([
      [0, 40],
      [540, 40],
      [570, 20],
      [600, 0],
    ]);
  });

  it('is flat until the movement begins when other axes reported in between', () => {
    const history = new AxisHistory(2);
    history.push(0, [0, 0]);
    // The second axis moves; the first is confirmed still at 1000 and moves right after.
    history.push(1000, [0, 0.5]);
    history.push(1020, [1, 0.5]);
    expect(points(tracePoints(history, 0, 2000, 2000, 200, 40))).toEqual([
      [0, 20],
      [100, 20],
      [102, 0],
      [200, 0],
    ]);
  });

  it('shows only what is inside the window, entering at the value it had before', () => {
    const history = new AxisHistory(1);
    history.push(0, [-1]);
    history.push(1000, [1]);
    history.push(9000, [0]);
    // The window is 4000..10000: the axis was at full travel when it began.
    expect(points(tracePoints(history, 0, 10_000, 6000, 600, 40))).toEqual([
      [0, 0],
      [500, 0],
      [500, 20],
      [600, 20],
    ]);
  });
});

describe('the trail of the stick plot', () => {
  it('is the path of two axes with how long ago each point was', () => {
    const history = new AxisHistory(2);
    history.push(0, [0, 0]);
    history.push(500, [0.5, 0]);
    history.push(1000, [0.5, 0.5]);
    expect(trailPoints(history, 0, 1, 1000, 1000)).toEqual([0, 0, 1, 0.5, 0, 0.5, 0.5, 0.5, 0]);
    // Swapped axes swap the picture.
    expect(trailPoints(history, 1, 0, 1000, 1000).slice(3, 5)).toEqual([0, 0.5]);
  });

  it('adds nothing while the stick stands still, and is empty without input', () => {
    const history = new AxisHistory(3);
    expect(trailPoints(history, 0, 1, 0, 1000)).toEqual([]);
    history.push(0, [0.2, 0.2, 0]);
    history.push(100, [0.2, 0.2, 0.9]);
    history.push(200, [0.2, 0.2, -0.9]);
    expect(trailPoints(history, 0, 1, 200, 1000)).toHaveLength(3);
  });

  it('fades out: a point from before the trail began is as old as a point can be', () => {
    const history = new AxisHistory(2);
    history.push(0, [-1, -1]);
    history.push(5000, [1, 1]);
    const trail = trailPoints(history, 0, 1, 5100, 1000);
    expect(trail).toEqual([-1, -1, 1, 1, 1, 0.1]);
  });
});

describe('which axes are plotted against each other', () => {
  const device = (axisNames: string[], numAxes = axisNames.length) => ({ axisNames, numAxes });

  it('offers the pairs DirectInput names, the stick first', () => {
    const pairs = stickPairs(device(['X', 'Y', 'RX', 'RY', 'RZ', 'SLIDER1']));
    expect(pairs).toEqual([
      { x: 0, y: 1, label: 'X axis and Y axis' },
      { x: 2, y: 3, label: 'X rotation and Y rotation' },
    ]);
    expect(
      stickPairs(device(['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2']))
    ).toHaveLength(4);
  });

  it('pairs the first two axes when none are named as a pair, and nothing with fewer than two', () => {
    expect(stickPairs(device(['X', 'Z', 'SLIDER1']))).toEqual([
      { x: 0, y: 1, label: 'X axis and Z axis' },
    ]);
    expect(stickPairs(device([], 2))).toEqual([{ x: 0, y: 1, label: 'Axis 1 and Axis 2' }]);
    expect(stickPairs(device(['SLIDER1']))).toEqual([]);
    expect(stickPairs(device([], 0))).toEqual([]);
  });
});

describe('the strip of one controller in the list', () => {
  it('draws the axes as bars and then the buttons in three rows, in reading order', () => {
    const strip = stripLayout(6, 42);
    expect(strip.height).toBe(26);
    expect(strip.axes).toHaveLength(6);
    expect(strip.axes[1]).toEqual({ x: 10, width: 7 });
    expect(strip.pips).toHaveLength(42);
    // 42 buttons in three rows of fourteen: Button 2 is right of Button 1, Button 15 below it.
    const [first, second] = strip.pips;
    expect(second!.y).toBe(first!.y);
    expect(second!.x - first!.x).toBe(8);
    expect(strip.pips[14]!.x).toBe(first!.x);
    expect(strip.pips[14]!.y - first!.y).toBe(8);
    expect(first!.x).toBe(6 * 10 - 3 + 14);
    expect(strip.width).toBe(first!.x + 14 * 8 - 2);
  });

  it('draws a big panel smaller, in four rows, so no strip outgrows its card', () => {
    const widest = 8 * 10 - 3 + 14 + 256;
    for (const buttons of [108, 128]) {
      const big = stripLayout(8, buttons);
      expect(new Set(big.pips.map((p) => p.y)).size).toBe(4);
      expect(big.pips[0]!.size).toBe(4);
    }
    for (const buttons of [42, 62, 64, 96, 108, 128]) {
      const strip = stripLayout(8, buttons);
      expect(strip.width).toBeLessThanOrEqual(widest);
      expect(Math.max(...strip.pips.map((p) => p.y + p.size))).toBeLessThanOrEqual(26);
    }
    expect(new Set(stripLayout(8, 96).pips.map((p) => p.y)).size).toBe(3);
  });

  it('has no gap to spare for a controller without axes or without buttons', () => {
    expect(stripLayout(0, 64).pips[0]!.x).toBe(0);
    const pedals = stripLayout(3, 0);
    expect(pedals.pips).toEqual([]);
    expect(pedals.width).toBe(3 * 10 - 3);
    expect(stripLayout(0, 0)).toEqual({ width: 0, height: 26, axes: [], pips: [] });
  });
});

describe('the directions of a hat', () => {
  it('are eight, clockwise from up, with the letters games use', () => {
    expect(HAT_POINTS.map((p) => p.code).join(' ')).toBe('U UR R DR D DL L UL');
    expect(HAT_POINTS.map((p) => p.angle)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(HAT_POINTS[5]!.direction).toBe('down-left');
  });
});
