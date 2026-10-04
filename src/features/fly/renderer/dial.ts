/**
 * The geometry of the readiness dial: one arc per checklist item, clockwise from the top,
 * with a small gap between neighbours. Pure, so the drawing is tested without a browser.
 */

/** What one item contributes to the dial. */
export type SegmentState = 'pending' | 'pass' | 'warn' | 'fail' | 'off';

export interface DialSegment {
  /** The SVG path of the arc, on the ring. */
  d: string;
  state: SegmentState;
  /** Position in the ring, for staggering. */
  index: number;
  /**
   * How far the arc is pushed out from the dial's centre (1 = on the ring). A warning
   * stands a little out of the ring and a failure further, so the states differ in shape
   * as well as in colour.
   */
  scale: number;
}

export interface DialGeometry {
  /** Side of the square the dial is drawn in. */
  size: number;
  /** Radius of the ring's centre line. */
  radius: number;
  /** How far a segment that is not met stands out of the ring. */
  raise: { warn: number; fail: number };
}

export const DIAL: DialGeometry = { size: 132, radius: 54, raise: { warn: 3, fail: 6 } };

const round = (n: number): number => Math.round(n * 100) / 100;

/** A point on a circle around the dial's centre; 0 degrees is the top, angles run clockwise. */
export function pointAt(
  degrees: number,
  radius: number,
  size = DIAL.size
): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: round(size / 2 + radius * Math.cos(radians)),
    y: round(size / 2 + radius * Math.sin(radians)),
  };
}

/** The arc from one angle to another (clockwise), as an SVG path. */
export function arcPath(from: number, to: number, radius: number, size = DIAL.size): string {
  // A full circle has no direction for an arc to take: stop just short of it.
  const end = to - from >= 360 ? from + 359.99 : to;
  const a = pointAt(from, radius, size);
  const b = pointAt(end, radius, size);
  const large = end - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

/** The gap between two segments, in degrees: narrower as the ring gets crowded. */
export function gapFor(count: number): number {
  if (count <= 1) return 0;
  if (count <= 24) return 3;
  if (count <= 60) return 2;
  return Math.min(1, 360 / count / 3);
}

/** How far out a segment in this state is drawn, as a factor of the ring's radius. */
export function scaleFor(state: SegmentState, geometry: DialGeometry = DIAL): number {
  const raise = state === 'fail' ? geometry.raise.fail : state === 'warn' ? geometry.raise.warn : 0;
  return round((geometry.radius + raise) / geometry.radius);
}

/** One arc per item, in the order given. */
export function dialSegments(states: SegmentState[], geometry: DialGeometry = DIAL): DialSegment[] {
  const count = states.length;
  if (count === 0) return [];
  const gap = gapFor(count);
  const span = 360 / count;
  return states.map((state, index) => ({
    d: arcPath(
      index * span + gap / 2,
      (index + 1) * span - gap / 2,
      geometry.radius,
      geometry.size
    ),
    state,
    index,
    scale: scaleFor(state, geometry),
  }));
}
