/**
 * What an axis filter does to the input, for the preview next to the filter fields.
 * It follows what DCS's axis tune panel shows: deadzone, saturation X and Y, a
 * curvature (or a user curve of several points), invert, and "slider" for axes that
 * run one way (throttles). It is a picture to judge the settings by, not DCS's own
 * arithmetic to the last digit.
 */

export interface CurveFilter {
  deadzone: number;
  saturationX: number;
  saturationY: number;
  invert: boolean;
  slider: boolean;
  curvature: number[];
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Output for a deflection of 0..1 (after deadzone and saturation X). */
function shape(t: number, curvature: number[]): number {
  if (curvature.length > 1) {
    // A user curve: the points are the outputs at equal steps of input, joined by lines.
    const steps = curvature.length - 1;
    const at = clamp(t, 0, 1) * steps;
    const index = Math.min(steps - 1, Math.floor(at));
    const from = curvature[index] ?? 0;
    const to = curvature[index + 1] ?? from;
    return from + (to - from) * (at - index);
  }
  const c = clamp(curvature[0] ?? 0, -1, 1);
  // Positive curvature flattens the centre (finer control), negative steepens it.
  return c >= 0 ? (1 - c) * t + c * t ** 3 : (1 + c) * t - c * (1 - (1 - t) ** 3);
}

/** The axis output (-1..1, or 0..1 for a slider) for an input of -1..1. */
export function axisOutput(filter: CurveFilter, input: number): number {
  const x = clamp(input, -1, 1);
  let out: number;
  if (filter.slider) {
    // One-directional: the whole travel maps to 0..1.
    const travel = (x + 1) / 2;
    const dead = clamp(filter.deadzone, 0, 0.99);
    const t = travel <= dead ? 0 : (travel - dead) / (1 - dead);
    out = shape(clamp(t / Math.max(filter.saturationX, 0.01), 0, 1), filter.curvature);
    out = clamp(out * filter.saturationY, 0, 1);
    return filter.invert ? 1 - out : out;
  }
  const dead = clamp(filter.deadzone, 0, 0.99);
  const magnitude = Math.abs(x);
  const t = magnitude <= dead ? 0 : (magnitude - dead) / (1 - dead);
  out = shape(clamp(t / Math.max(filter.saturationX, 0.01), 0, 1), filter.curvature);
  out = clamp(out * filter.saturationY, 0, 1) * Math.sign(x);
  return filter.invert ? -out : out;
}

/** Points of the response curve as an SVG polyline in a box of the given size (y grows downwards). */
export function curvePoints(
  filter: CurveFilter,
  width: number,
  height: number,
  samples = 48
): string {
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const input = -1 + (2 * i) / samples;
    const output = axisOutput(filter, input);
    const y = filter.slider ? height - output * height : height / 2 - (output * height) / 2;
    points.push(`${((i / samples) * width).toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}
