import { describe, expect, it } from 'vitest';
import { axisOutput, curvePoints } from './curve';
import { DEFAULT_FILTER } from './diff';

describe('axis filter preview', () => {
  it('reflects deadzone, saturation, curvature, invert and slider', () => {
    const flat = DEFAULT_FILTER;
    expect([-1, -0.5, 0, 0.5, 1].map((x) => axisOutput(flat, x))).toEqual([-1, -0.5, 0, 0.5, 1]);

    // Curvature flattens the centre and still reaches full deflection.
    const curved = { ...flat, curvature: [0.15] };
    expect(axisOutput(curved, 0.5)).toBeCloseTo(0.44375);
    expect(axisOutput(curved, 0.5)).toBeLessThan(0.5);
    expect(axisOutput(curved, 1)).toBe(1);
    expect(axisOutput(curved, -0.5)).toBeCloseTo(-0.44375);
    // Negative curvature does the opposite.
    expect(axisOutput({ ...flat, curvature: [-0.3] }, 0.5)).toBeGreaterThan(0.5);

    // Inside the deadzone nothing happens; outside, the rest of the travel is used.
    const dead = { ...flat, deadzone: 0.2 };
    expect(axisOutput(dead, 0.1)).toBe(0);
    expect(axisOutput(dead, 0.6)).toBeCloseTo(0.5);
    expect(axisOutput(dead, 1)).toBe(1);

    // Saturation X reaches full output early; saturation Y caps the output.
    expect(axisOutput({ ...flat, saturationX: 0.5 }, 0.5)).toBe(1);
    expect(axisOutput({ ...flat, saturationY: 0.25 }, 1)).toBe(0.25);
    expect(axisOutput({ ...flat, invert: true }, 0.4)).toBeCloseTo(-0.4);

    // A slider (throttle) runs one way: 0 at one end, 1 at the other.
    const slider = { ...flat, slider: true };
    expect([-1, 0, 1].map((x) => axisOutput(slider, x))).toEqual([0, 0.5, 1]);
    expect(axisOutput({ ...slider, invert: true }, -1)).toBe(1);
    expect(axisOutput({ ...slider, deadzone: 0.5 }, 0)).toBe(0);

    // A user curve goes through its points.
    const user = { ...flat, curvature: [0, 0.1, 0.2, 0.5, 1] };
    expect(axisOutput(user, 0.5)).toBeCloseTo(0.2);
    expect(axisOutput(user, 0.75)).toBeCloseTo(0.5);
    expect(axisOutput(user, 1)).toBe(1);
    // Input outside the range is clamped.
    expect(axisOutput(flat, 3)).toBe(1);
  });

  it('draws the curve as polyline points', () => {
    expect(curvePoints(DEFAULT_FILTER, 100, 100, 4)).toBe(
      '0.0,100.0 25.0,75.0 50.0,50.0 75.0,25.0 100.0,0.0'
    );
    expect(curvePoints({ ...DEFAULT_FILTER, slider: true, invert: true }, 100, 50, 2)).toBe(
      '0.0,0.0 50.0,25.0 100.0,50.0'
    );
    expect(curvePoints(DEFAULT_FILTER, 10, 10).split(' ')).toHaveLength(49);
  });
});
