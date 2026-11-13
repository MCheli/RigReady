import type { InputDevice } from '../../../shared/models';

/**
 * What the axes of a wheel base are, for the input tester: its wheel view and the names of
 * the axes. Only bases whose axes a source names are here. Every other controller, a wheel
 * base of another make included, keeps the general view and Windows' names for its axes.
 *
 * Fanatec: the driver names the axes itself (its OEM entries in the registry, read from the
 * BeamNG log of the recorded rig; docs/research/racing.md, "Axis names on COL01"). The
 * racing feature shows the same names on its Wheel page (racing/core/wheelbases/brands.ts).
 * Features do not import each other, so tests/unit/wheelAxisNames.test.ts holds the two
 * tables together: a name or a base added on one side fails there until the other follows.
 */

export type WheelAxisRole = 'steering' | 'combined' | 'accelerator' | 'brake' | 'clutch' | 'dial';

export interface WheelAxis {
  /** Position among the controller's axes. */
  index: number;
  /** What the maker calls it: "Wheel", "Brake". */
  name: string;
  role: WheelAxisRole;
}

/** DirectInput axis (as InputDevice.axisNames has it) -> what it is on the base. */
const FANATEC_AXES: Record<string, { name: string; role: WheelAxisRole }> = {
  X: { name: 'Wheel', role: 'steering' },
  Y: { name: 'Combined pedals', role: 'combined' },
  Z: { name: 'Accelerator', role: 'accelerator' },
  RZ: { name: 'Brake', role: 'brake' },
  SLIDER1: { name: 'Clutch', role: 'clutch' },
  SLIDER2: { name: 'Dial', role: 'dial' },
};

const FANATEC_VENDOR = '0EB7';

/** USB product ids of Fanatec wheel bases (docs/research/racing.md 1.3). */
const FANATEC_BASES: ReadonlySet<string> = new Set([
  '0001',
  '0004',
  '0005',
  '0006',
  '0007',
  '0011',
  '0020',
  '0197',
  '0E03',
]);

type Ids = Partial<Pick<InputDevice, 'vendorId' | 'productId'>>;

function tableOf(device: Ids | undefined): typeof FANATEC_AXES | undefined {
  const vendor = device?.vendorId?.toUpperCase();
  const product = device?.productId?.toUpperCase();
  return vendor === FANATEC_VENDOR && product && FANATEC_BASES.has(product)
    ? FANATEC_AXES
    : undefined;
}

/** What the maker calls a DirectInput axis ("X", "SLIDER1") of this controller, where known. */
export function wheelAxisName(
  device: Ids | undefined,
  axis: string | undefined
): string | undefined {
  return axis ? tableOf(device)?.[axis.toUpperCase()]?.name : undefined;
}

/**
 * The axes of a wheel base the tester draws as a wheel: steering, pedals and the rest, by
 * what they are. Undefined for a controller whose axes RigReady has no source for, and for
 * a base that reports no steering axis.
 */
export function wheelAxes(
  device: (Ids & Pick<InputDevice, 'axisNames'>) | undefined
): WheelAxis[] | undefined {
  const table = tableOf(device);
  if (!table || !device) return undefined;
  const axes = device.axisNames.flatMap((axis, index) => {
    const known = table[axis.toUpperCase()];
    return known ? [{ index, ...known }] : [];
  });
  return axes.some((a) => a.role === 'steering') ? axes : undefined;
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** Within this of the centre the wheel is said to be straight (1% of the travel each way). */
const STRAIGHT = 0.02;

export interface Steering {
  side: 'left' | 'right' | 'centre';
  /** 0 .. 100: how much of the travel to that side is used. */
  percent: number;
  /** "Left 37%", "Right 100%", "Centre". */
  text: string;
}

/**
 * The steering axis in words. DirectInput reports the share of the travel, not degrees:
 * how far the rim turns for it is set on the base and is not read here.
 */
export function steering(value: number): Steering {
  const v = clamp(value);
  if (Math.abs(v) < STRAIGHT) return { side: 'centre', percent: 0, text: 'Centre' };
  const percent = Math.round(Math.abs(v) * 100);
  return v < 0
    ? { side: 'left', percent, text: `Left ${percent}%` }
    : { side: 'right', percent, text: `Right ${percent}%` };
}

/** A first reading this near the high end means the pedal rests there. */
const RESTS_HIGH = 0.8;

/**
 * How far a pedal is pressed, 0 .. 1, counted from the end it rests at. No source says at
 * which end of its axis a pedal rests, so that is taken from `rest`, the first value read
 * from the pedal: near the high end, pressing moves the axis down; anywhere else, up.
 */
export function pedalTravel(value: number, rest: number | undefined): number {
  const v = clamp(value);
  return rest !== undefined && clamp(rest) > RESTS_HIGH ? (1 - v) / 2 : (v + 1) / 2;
}
