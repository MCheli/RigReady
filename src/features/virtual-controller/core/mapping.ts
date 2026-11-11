import type { InputDevice, InputState, PadReport } from '../../../shared/models';
import {
  BUTTON_BITS,
  BUTTON_NAMES,
  STICK_NAMES,
  type ControllerRef,
  type PadProfile,
  type Source,
  type SplitThrottle,
  type StickAxis,
  type Trigger,
} from './profile';

/**
 * The mapping math: real controller state in, a virtual controller report out. Pure, so
 * every curve, deadzone and split is unit tested. Sticks are -1 to 1 with up and right
 * positive (XInput's sense; DirectInput's Y is positive when pulled back, so a flight
 * stick's pitch is inverted onto a gamepad stick). Triggers are 0 to 1.
 */

const clamp = (v: number, low: number, high: number): number =>
  Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : 0;

/** A centred axis (-1 to 1) through invert, deadzone, range and curve. */
export function shapeStick(raw: number, shape: Omit<StickAxis, 'source'>): number {
  let v = clamp(raw, -1, 1);
  if (shape.invert) v = -v;
  const magnitude = Math.abs(v);
  if (magnitude <= shape.deadzone) return 0;
  // What is left after the deadzone is stretched back to the whole range, so the output
  // starts at zero at the edge of the deadzone rather than jumping.
  let out = (magnitude - shape.deadzone) / (1 - shape.deadzone);
  out = clamp(out / shape.range, 0, 1);
  out = Math.pow(out, shape.curve);
  return Math.sign(v) * out;
}

/**
 * An axis that starts at one end (a pedal, a throttle) onto a trigger: -1 is released and
 * 1 fully pressed (inverted when the pedal reads the other way), through deadzone, range
 * and curve.
 */
export function shapeTrigger(raw: number, shape: Omit<Trigger, 'source'>): number {
  let v = clamp(raw, -1, 1);
  if (shape.invert) v = -v;
  const travel = (v + 1) / 2;
  if (travel <= shape.deadzone) return 0;
  let out = (travel - shape.deadzone) / (1 - shape.deadzone);
  out = clamp(out / shape.range, 0, 1);
  return Math.pow(out, shape.curve);
}

/**
 * One throttle axis over two triggers. The travel from the back (0) to the front (1) is
 * split at `split`: forward of it is RT, behind it LT, each from 0 at the split to 1 at its
 * end, with its own deadzone next to the split and the same curve.
 */
export function splitThrottle(
  raw: number,
  shape: Omit<SplitThrottle, 'source'>
): { lt: number; rt: number } {
  let v = clamp(raw, -1, 1);
  if (shape.invert) v = -v;
  const travel = (v + 1) / 2;
  const side = (amount: number): number => {
    if (amount <= shape.deadzone) return 0;
    return Math.pow(clamp((amount - shape.deadzone) / (1 - shape.deadzone), 0, 1), shape.curve);
  };
  if (travel >= shape.split) {
    return { lt: 0, rt: side((travel - shape.split) / (1 - shape.split)) };
  }
  return { lt: side((shape.split - travel) / shape.split), rt: 0 };
}

/** Which controller of the ones connected a reference means: its GUID, else its name. */
export function resolveController(
  ref: ControllerRef,
  devices: InputDevice[]
): InputDevice | undefined {
  if (ref.guid) {
    const exact = devices.find((d) => d.guid.toUpperCase() === ref.guid!.toUpperCase());
    if (exact) return exact;
  }
  return (
    devices.find((d) => d.name === ref.name) ??
    devices.find((d) => d.name.trim() === ref.name.trim())
  );
}

type Reader = (states: Map<number, InputState>) => number;

const HAT_DIRECTIONS: Record<string, (x: number, y: number) => boolean> = {
  // The four main directions include the diagonals next to them, as a d-pad does.
  U: (_x, y) => y === 1,
  D: (_x, y) => y === -1,
  L: (x) => x === -1,
  R: (x) => x === 1,
  UR: (x, y) => x === 1 && y === 1,
  DR: (x, y) => x === 1 && y === -1,
  DL: (x, y) => x === -1 && y === -1,
  UL: (x, y) => x === -1 && y === 1,
};

/**
 * A function that reads one source from live state: an axis gives -1 to 1, a button, a hat
 * direction or an axis used as a button gives 0 or 1. Undefined when the controller is not
 * connected or has no such input.
 */
export function sourceReader(source: Source, devices: InputDevice[]): Reader | undefined {
  const device = resolveController(source.device, devices);
  if (!device) return undefined;
  const index = device.index;
  const button = /^JOY_BTN(\d+)$/.exec(source.input);
  if (button) {
    const at = Number(button[1]) - 1;
    if (at >= device.numButtons) return undefined;
    return (states) => (states.get(index)?.buttons[at] ? 1 : 0);
  }
  const hat = /^JOY_BTN_POV(\d)_(\w+)$/.exec(source.input);
  if (hat) {
    const at = Number(hat[1]) - 1;
    const test = HAT_DIRECTIONS[hat[2]!];
    if (at >= device.numHats || !test) return undefined;
    return (states) => {
      const value = states.get(index)?.hats[at] ?? [0, 0];
      return test(value[0], value[1]) ? 1 : 0;
    };
  }
  const axis = device.axisNames.indexOf(source.input.replace(/^JOY_/, ''));
  if (axis < 0) return undefined;
  const value = (states: Map<number, InputState>): number => states.get(index)?.axes[axis] ?? 0;
  if (source.when === 'above') return (states) => (value(states) > 0.5 ? 1 : 0);
  if (source.when === 'below') return (states) => (value(states) < -0.5 ? 1 : 0);
  return value;
}

export const isAxisInput = (input: string): boolean => !input.startsWith('JOY_BTN');

/** A profile turned into readers for the controllers connected now. */
export interface MappingPlan {
  sticks: Partial<Record<(typeof STICK_NAMES)[number], { read: Reader; axis: boolean }>>;
  triggers: Partial<Record<'lt' | 'rt', { read: Reader; axis: boolean }>>;
  throttle?: Reader;
  buttons: { bit: number; read: Reader }[];
  /** Parts whose controller is not connected or lacks the input, by part. */
  missing: string[];
  /** Parts that are mapped and found. */
  mapped: string[];
}

export function planMapping(profile: PadProfile, devices: InputDevice[]): MappingPlan {
  const plan: MappingPlan = { sticks: {}, triggers: {}, buttons: [], missing: [], mapped: [] };
  const take = (part: string, source: Source | undefined): Reader | undefined => {
    if (!source) return undefined;
    const read = sourceReader(source, devices);
    if (read) plan.mapped.push(part);
    else plan.missing.push(part);
    return read;
  };
  for (const name of STICK_NAMES) {
    const source = profile.sticks[name].source;
    const read = take(name, source);
    if (read && source)
      plan.sticks[name] = { read, axis: isAxisInput(source.input) && !source.when };
  }
  const throttle = profile.throttle?.source ? take('throttle', profile.throttle.source) : undefined;
  if (profile.throttle?.source) {
    if (throttle) plan.throttle = throttle;
  } else {
    for (const name of ['lt', 'rt'] as const) {
      const source = profile.triggers[name].source;
      const read = take(name, source);
      if (read && source) {
        plan.triggers[name] = { read, axis: isAxisInput(source.input) && !source.when };
      }
    }
  }
  for (const name of BUTTON_NAMES) {
    const read = take(name, profile.buttons[name]?.source);
    if (read) plan.buttons.push({ bit: BUTTON_BITS[name], read });
  }
  return plan;
}

/** The virtual controller's report for the latest state of every controller. */
export function computeReport(
  profile: PadProfile,
  plan: MappingPlan,
  states: Map<number, InputState>
): PadReport {
  const report: PadReport = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 };
  for (const name of STICK_NAMES) {
    const entry = plan.sticks[name];
    if (!entry) continue;
    const raw = entry.read(states);
    // A button on a stick pushes it all the way (to the side `invert` says).
    report[name] = entry.axis
      ? shapeStick(raw, profile.sticks[name])
      : raw * (profile.sticks[name].invert ? -1 : 1);
  }
  if (plan.throttle && profile.throttle) {
    const { lt, rt } = splitThrottle(plan.throttle(states), profile.throttle);
    report.lt = lt;
    report.rt = rt;
  } else {
    for (const name of ['lt', 'rt'] as const) {
      const entry = plan.triggers[name];
      if (!entry) continue;
      const raw = entry.read(states);
      report[name] = entry.axis ? shapeTrigger(raw, profile.triggers[name]) : raw;
    }
  }
  for (const { bit, read } of plan.buttons) {
    if (read(states) >= 0.5) report.buttons |= bit;
  }
  return report;
}

/** Two reports that a game could not tell apart (sticks within 1/32767). */
export function sameReport(a: PadReport | undefined, b: PadReport): boolean {
  if (!a) return false;
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1 / 32767;
  return (
    a.buttons === b.buttons &&
    near(a.lx, b.lx) &&
    near(a.ly, b.ly) &&
    near(a.rx, b.rx) &&
    near(a.ry, b.ry) &&
    near(a.lt, b.lt) &&
    near(a.rt, b.rt)
  );
}

/** Steering helper: the range for a wheel of `rotation` degrees to give full lock at `lock` degrees. */
export function wheelRange(rotationDegrees: number, lockDegrees: number): number {
  if (!(rotationDegrees > 0) || !(lockDegrees > 0)) return 1;
  return clamp(lockDegrees / rotationDegrees, 0.05, 1);
}

/**
 * Whether a controller is a virtual one of the kinds RigReady plugs in (an Xbox 360
 * controller or a DualShock 4 by their USB ids). It is never offered as a source: mapping
 * the virtual controller onto itself would feed it its own output.
 */
export function isVirtualPadLike(
  device: Pick<InputDevice, 'vendorId' | 'productId' | 'name'>
): boolean {
  const ids = `${device.vendorId}:${device.productId}`.toUpperCase();
  return ids === '045E:028E' || ids === '054C:05C4' || /xbox 360 for windows/i.test(device.name);
}
