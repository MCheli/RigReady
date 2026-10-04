import type { InputDevice } from '../../../shared/models';
import { axisLabel } from './input';

/**
 * What the input tester draws: a rolling record of each controller's axes, and the geometry
 * of its traces, its stick plot and its strip of buttons. Pure: there is no canvas in here,
 * the renderer only strokes what these functions hand it.
 */

/** How far back an axis trace goes. */
export const TRACE_MS = 6000;
/** How long the trail behind the dot of the stick plot lasts. */
export const TRAIL_MS = 1800;
/**
 * Two samples closer together than this are one continuous movement and are joined by a
 * straight line. Further apart, the axis stood still and then jumped: the line holds, then steps.
 */
export const HOLD_GAP_MS = 60;

const clamp = (v: number): number => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** What a drawing reads from the record of a controller's axes. */
export interface AxisRecord {
  readonly length: number;
  /** Time of sample `i`; 0 is the oldest kept. */
  time(i: number): number;
  /** Value of one axis in sample `i`, -1 .. 1. */
  value(i: number, axis: number): number;
  /** The sample to start drawing from for a window that begins at `since`. */
  from(since: number): number;
}

/**
 * The last few seconds of one controller's axes. A controller only reports when something
 * changed, so a sample is "the axes were like this from here on", and every axis of one
 * sample shares its time (which is what the stick plot needs).
 */
export class AxisHistory implements AxisRecord {
  private readonly times: Float64Array;
  private readonly values: Float32Array;
  private start = 0;
  private count = 0;
  /** Per axis: when its value last differed from the sample before. */
  private readonly changed: Float64Array;

  constructor(
    readonly axes: number,
    readonly capacity = 512
  ) {
    this.times = new Float64Array(capacity);
    this.values = new Float32Array(capacity * Math.max(1, axes));
    this.changed = new Float64Array(Math.max(1, axes)).fill(Number.NEGATIVE_INFINITY);
  }

  get length(): number {
    return this.count;
  }

  /** Time of the newest sample; -Infinity while there is none. */
  get latest(): number {
    return this.count === 0 ? Number.NEGATIVE_INFINITY : this.time(this.count - 1);
  }

  push(t: number, values: readonly number[]): void {
    const newest = this.count - 1;
    const at = (this.start + this.count) % this.capacity;
    for (let a = 0; a < this.axes; a++) {
      const value = clamp(values[a] ?? 0);
      // The first sample is where the axis rests, not a movement.
      if (newest >= 0 && value !== this.value(newest, a)) this.changed[a] = t;
      this.values[at * this.axes + a] = value;
    }
    this.times[at] = t;
    if (this.count === this.capacity) this.start = (this.start + 1) % this.capacity;
    else this.count++;
  }

  time(i: number): number {
    return this.times[(this.start + i) % this.capacity]!;
  }

  value(i: number, axis: number): number {
    return this.values[((this.start + i) % this.capacity) * this.axes + axis] ?? 0;
  }

  /**
   * Where to start drawing a window that begins at `since`: the last sample before it when
   * there is one (the line enters from the left edge at that value), else the first one in it.
   */
  from(since: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.time(mid) < since) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  /** When this axis last moved; -Infinity when it has not moved since the record began. */
  lastChange(axis: number): number {
    return this.changed[axis] ?? Number.NEGATIVE_INFINITY;
  }

  /** When any of the given axes last moved. */
  lastChangeOf(axes: readonly number[]): number {
    return Math.max(Number.NEGATIVE_INFINITY, ...axes.map((a) => this.lastChange(a)));
  }
}

/**
 * The line of one axis over the last `windowMs`, as x,y pairs for a canvas of `width` by
 * `height`: time runs left to right and ends "now" at the right edge, the value runs from the
 * bottom (0%) to the top (100%), kept `pad` pixels inside. The line always ends at the right
 * edge at the current value, so a still axis is a flat line and not an empty picture.
 */
export function tracePoints(
  history: AxisRecord,
  axis: number,
  now: number,
  windowMs: number,
  width: number,
  height: number,
  pad = 0
): number[] {
  if (history.length === 0) return [];
  const since = now - windowMs;
  const x = (t: number): number => ((Math.max(since, Math.min(now, t)) - since) / windowMs) * width;
  const y = (v: number): number => pad + (1 - (v + 1) / 2) * (height - 2 * pad);
  const first = history.from(since);
  let heldT = history.time(first);
  let heldV = history.value(first, axis);
  // The first value known is drawn from the left edge: a controller reports where it rests
  // when the tester opens, and that is where it was before.
  let drawnT = Math.min(since, heldT);
  const out = [0, y(heldV)];
  for (let i = first + 1; i < history.length; i++) {
    const t = history.time(i);
    const v = history.value(i, axis);
    if (v !== heldV) {
      // Until when the old value held: up to this sample after a pause, or only up to the
      // previous one while the axis is in motion.
      const until = t - heldT > HOLD_GAP_MS ? t : heldT;
      if (until > drawnT) out.push(x(until), y(heldV));
      out.push(x(t), y(v));
      drawnT = t;
    }
    heldT = t;
    heldV = v;
  }
  if (now > drawnT) out.push(x(now), y(heldV));
  return out;
}

/**
 * The path a pair of axes took over the last `trailMs`, oldest first, as x, y, age triples:
 * x and y in -1 .. 1, age from 1 (about to fade out) to 0 (now). Standing still adds nothing.
 */
export function trailPoints(
  history: AxisRecord,
  xAxis: number,
  yAxis: number,
  now: number,
  trailMs: number
): number[] {
  const out: number[] = [];
  if (history.length === 0) return out;
  const since = now - trailMs;
  for (let i = history.from(since); i < history.length; i++) {
    const px = history.value(i, xAxis);
    const py = history.value(i, yAxis);
    const age = Math.max(0, Math.min(1, (now - history.time(i)) / trailMs));
    const n = out.length;
    if (n >= 3 && out[n - 3] === px && out[n - 2] === py) continue;
    out.push(px, py, age);
  }
  return out;
}

export interface AxisPair {
  /** Indexes into the controller's axes: across, and up and down. */
  x: number;
  y: number;
  /** "X axis and Y axis". */
  label: string;
}

/** Axes that belong together on a stick, a mini-stick or a pair of pedals, by DirectInput name. */
const NATURAL_PAIRS: readonly (readonly [string, string])[] = [
  ['X', 'Y'],
  ['RX', 'RY'],
  ['Z', 'RZ'],
  ['SLIDER1', 'SLIDER2'],
];

/**
 * The pairs of axes worth plotting against each other: the ones DirectInput names as a
 * pair come first (X with Y is a stick), and a controller with two or more axes that name
 * no pair still gets its first two. Empty for a controller with fewer than two axes.
 */
export function stickPairs(device: Pick<InputDevice, 'axisNames' | 'numAxes'>): AxisPair[] {
  const count = Math.max(device.numAxes, device.axisNames.length);
  if (count < 2) return [];
  const pair = (x: number, y: number): AxisPair => ({
    x,
    y,
    label: `${axisLabel(device, x)} and ${axisLabel(device, y)}`,
  });
  const pairs: AxisPair[] = [];
  for (const [a, b] of NATURAL_PAIRS) {
    const x = device.axisNames.indexOf(a);
    const y = device.axisNames.indexOf(b);
    if (x >= 0 && y >= 0) pairs.push(pair(x, y));
  }
  return pairs.length > 0 ? pairs : [pair(0, 1)];
}

export interface StripLayout {
  /** Size of the whole strip in CSS pixels. */
  width: number;
  height: number;
  /** One bar per axis. */
  axes: { x: number; width: number }[];
  /** One square per button, in reading order: Button 1 is top left, Button 2 to its right. */
  pips: { x: number; y: number; size: number }[];
}

const AXIS_WIDTH = 7;
const AXIS_GAP = 3;
const GROUP_GAP = 14;
/** The widest the buttons of one controller may get before they are drawn smaller. */
const PIPS_MAX_WIDTH = 256;

/**
 * Where everything goes in the strip of one controller in the all-controllers list: its
 * axes as level bars, then every button as a small square in three rows (four smaller rows
 * for a panel with more than about a hundred buttons, so the strip keeps its width).
 */
export function stripLayout(numAxes: number, numButtons: number, height = 26): StripLayout {
  const axes = Array.from({ length: Math.max(0, numAxes) }, (_, i) => ({
    x: i * (AXIS_WIDTH + AXIS_GAP),
    width: AXIS_WIDTH,
  }));
  const axesWidth = axes.length > 0 ? axes.length * (AXIS_WIDTH + AXIS_GAP) - AXIS_GAP : 0;
  const buttons = Math.max(0, numButtons);
  const fits = (rows: number, pitch: number): boolean =>
    Math.ceil(buttons / rows) * pitch - 2 <= PIPS_MAX_WIDTH;
  const [rows, pitch] = fits(3, 8) ? [3, 8] : [4, 6];
  const size = pitch - 2;
  const columns = Math.ceil(buttons / rows);
  const left = axesWidth > 0 && buttons > 0 ? axesWidth + GROUP_GAP : axesWidth;
  const top = Math.max(0, Math.floor((height - (rows * pitch - 2)) / 2));
  const pips = Array.from({ length: buttons }, (_, i) => ({
    x: left + (i % columns) * pitch,
    y: top + Math.floor(i / columns) * pitch,
    size,
  }));
  const pipsWidth = columns > 0 ? columns * pitch - 2 : 0;
  return { width: left + pipsWidth, height, axes, pips };
}

/** The eight directions of a hat, clockwise from up, with the angle each points at. */
export const HAT_POINTS: readonly { direction: string; angle: number; code: string }[] = [
  { direction: 'up', angle: 0, code: 'U' },
  { direction: 'up-right', angle: 45, code: 'UR' },
  { direction: 'right', angle: 90, code: 'R' },
  { direction: 'down-right', angle: 135, code: 'DR' },
  { direction: 'down', angle: 180, code: 'D' },
  { direction: 'down-left', angle: 225, code: 'DL' },
  { direction: 'left', angle: 270, code: 'L' },
  { direction: 'up-left', angle: 315, code: 'UL' },
];
