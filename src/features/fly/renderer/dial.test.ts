import { describe, expect, it } from 'vitest';
import { arcPath, DIAL, dialSegments, gapFor, pointAt, scaleFor, type SegmentState } from './dial';

const numbers = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('the readiness dial', () => {
  it('starts at the top and runs clockwise', () => {
    const centre = DIAL.size / 2;
    expect(pointAt(0, 50)).toEqual({ x: centre, y: centre - 50 });
    expect(pointAt(90, 50)).toEqual({ x: centre + 50, y: centre });
    expect(pointAt(180, 50)).toEqual({ x: centre, y: centre + 50 });
    expect(pointAt(270, 50)).toEqual({ x: centre - 50, y: centre });
  });

  it('draws one arc per item, in order, with a gap between neighbours', () => {
    const states: SegmentState[] = ['pass', 'pass', 'pending', 'pass'];
    const segments = dialSegments(states);
    expect(segments.map((s) => [s.index, s.state])).toEqual([
      [0, 'pass'],
      [1, 'pass'],
      [2, 'pending'],
      [3, 'pass'],
    ]);
    // Four items: quarter turns, each cut short by half a gap at both ends.
    const gap = gapFor(4);
    expect(segments[0]!.d).toBe(arcPath(gap / 2, 90 - gap / 2, DIAL.radius));
    expect(segments[3]!.d).toBe(arcPath(270 + gap / 2, 360 - gap / 2, DIAL.radius));
    // No arc ends where the next one starts.
    const end = numbers(segments[0]!.d).slice(-2);
    const start = numbers(segments[1]!.d).slice(0, 2);
    expect(end).not.toEqual(start);
  });

  it('a warning stands out of the ring and a failure further: shape, not colour alone', () => {
    const [pass, pending, off, warn, fail] = dialSegments([
      'pass',
      'pending',
      'off',
      'warn',
      'fail',
    ]);
    expect([pass!.scale, pending!.scale, off!.scale]).toEqual([1, 1, 1]);
    expect(warn!.scale).toBeGreaterThan(1);
    expect(fail!.scale).toBeGreaterThan(warn!.scale);
    expect(scaleFor('fail')).toBe(fail!.scale);
    // The furthest point of a raised segment, with its line width, still fits in the drawing.
    expect(DIAL.radius * fail!.scale + 3).toBeLessThanOrEqual(DIAL.size / 2);
  });

  it('one item is a whole ring, and none is no ring', () => {
    expect(dialSegments([])).toEqual([]);
    const [only] = dialSegments(['pass']);
    expect(gapFor(1)).toBe(0);
    // A closed arc cannot be drawn: it stops a hair short of a full turn.
    const [x0, y0, , , , large, sweep, x1, y1] = numbers(only!.d);
    expect([large, sweep]).toEqual([1, 1]);
    expect(Math.hypot(x1! - x0!, y1! - y0!)).toBeLessThan(0.1);
  });

  it('a long checklist keeps every segment visible: the gap narrows, an arc never has no length', () => {
    for (const count of [24, 25, 60, 61, 150]) {
      const gap = gapFor(count);
      expect(gap).toBeGreaterThan(0);
      expect(360 / count - gap).toBeGreaterThan(0);
      const segments = dialSegments(Array.from({ length: count }, () => 'pass' as const));
      expect(segments).toHaveLength(count);
      expect(new Set(segments.map((s) => s.d)).size).toBe(count);
    }
    expect(gapFor(24)).toBe(3);
    expect(gapFor(25)).toBe(2);
  });

  it('an arc over half the ring takes the long way round', () => {
    expect(numbers(arcPath(0, 200, 50))[5]).toBe(1);
    expect(numbers(arcPath(0, 100, 50))[5]).toBe(0);
  });
});
