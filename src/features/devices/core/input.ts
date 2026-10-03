import type { InputDevice, InputState } from '../../../shared/models';

/**
 * How controller input is shown and described, the way a game sees it. The sidecar
 * reports DirectInput axes as -1..1 (it sets the range to ±32767), buttons as booleans in
 * DirectInput order and POV hats as [x, y] with y = 1 for up. Pure: renderer and main use it.
 */

export const AXIS_LABELS: Record<string, string> = {
  X: 'X axis',
  Y: 'Y axis',
  Z: 'Z axis',
  RX: 'X rotation',
  RY: 'Y rotation',
  RZ: 'Z rotation',
  SLIDER1: 'Slider 1',
  SLIDER2: 'Slider 2',
};

export function axisLabel(device: Pick<InputDevice, 'axisNames'> | undefined, i: number): string {
  const name = device?.axisNames[i];
  return name ? (AXIS_LABELS[name] ?? name) : `Axis ${i + 1}`;
}

/** The name DCS gives the axis (JOY_X, JOY_RZ, JOY_SLIDER1). */
export function axisGameName(
  device: Pick<InputDevice, 'axisNames'> | undefined,
  i: number
): string {
  const name = device?.axisNames[i];
  return name ? `JOY_${name}` : `JOY_AXIS${i + 1}`;
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** The unsigned 16-bit value Windows' game controller panel shows: 0 .. 65535, centre 32767. */
export function axisRaw(value: number): number {
  return Math.min(65535, Math.floor((clamp(value) + 1) * 32767.5));
}

/** 0 .. 100, centre 50. */
export function axisPercent(value: number): number {
  return ((clamp(value) + 1) / 2) * 100;
}

/** Buttons are numbered as games number them: the first is Button 1 (JOY_BTN1). */
export const buttonLabel = (i: number): string => `Button ${i + 1}`;
export const buttonGameName = (i: number): string => `JOY_BTN${i + 1}`;

const HAT_NAMES: Record<string, string> = {
  '0,0': 'centred',
  '0,1': 'up',
  '1,1': 'up-right',
  '1,0': 'right',
  '1,-1': 'down-right',
  '0,-1': 'down',
  '-1,-1': 'down-left',
  '-1,0': 'left',
  '-1,1': 'up-left',
};

export function hatDirection(hat: readonly [number, number] | undefined): string {
  if (!hat) return 'centred';
  return HAT_NAMES[`${Math.sign(hat[0])},${Math.sign(hat[1])}`] ?? 'centred';
}

export const hatLabel = (i: number): string => `Hat ${i + 1}`;

/**
 * A stable key for one controller, used to remember things about it (switches that are
 * normally on). DirectInput instance GUIDs can change when Windows re-enumerates, so the
 * key is the model plus its position among controllers of the same model.
 */
export function inputKeyFor(device: InputDevice, all: InputDevice[]): string {
  if (!device.vendorId || !device.productId) return `guid:${device.guid.toUpperCase()}`;
  const model = all
    .filter((d) => d.vendorId === device.vendorId && d.productId === device.productId)
    .sort((a, b) => a.guid.localeCompare(b.guid));
  const ordinal = Math.max(
    0,
    model.findIndex((d) => d.guid === device.guid)
  );
  return `${device.vendorId}:${device.productId}#${ordinal + 1}`;
}

export interface InputChange {
  kind: 'button' | 'hat' | 'axis';
  index: number;
  /** "Button 12 pressed", "Hat 1 up", "Z axis 63%". */
  text: string;
  /** Pressed, hat direction, or axis value. */
  value: boolean | string | number;
}

/** What changed between two states of one controller. Axis changes below `axisStep` are ignored. */
export function diffStates(
  device: Pick<InputDevice, 'axisNames'> | undefined,
  previous: InputState | undefined,
  next: InputState,
  axisStep = 0
): InputChange[] {
  const changes: InputChange[] = [];
  next.buttons.forEach((pressed, i) => {
    const before = previous?.buttons[i] ?? false;
    if (pressed !== before) {
      changes.push({
        kind: 'button',
        index: i,
        text: `${buttonLabel(i)} ${pressed ? 'pressed' : 'released'}`,
        value: pressed,
      });
    }
  });
  next.hats.forEach((hat, i) => {
    const before = hatDirection(previous?.hats[i]);
    const now = hatDirection(hat);
    if (now !== before) {
      changes.push({ kind: 'hat', index: i, text: `${hatLabel(i)} ${now}`, value: now });
    }
  });
  next.axes.forEach((value, i) => {
    const before = previous?.axes[i];
    if (before !== undefined && value !== before && Math.abs(value - before) > axisStep) {
      changes.push({
        kind: 'axis',
        index: i,
        text: `${axisLabel(device, i)} ${Math.round(axisPercent(value))}%`,
        value,
      });
    }
  });
  return changes;
}

const percentText = (v: number): string => `${Math.round(axisPercent(v))}%`;

/** "Z axis moved 12% → 63%", or "... moved and came back to 50%" for a movement that returned. */
function movedText(label: string, from: number, to: number): string {
  return Math.round(axisPercent(from)) === Math.round(axisPercent(to))
    ? `${label} moved and came back to ${percentText(to)}`
    : `${label} moved ${percentText(from)} → ${percentText(to)}`;
}

export interface LogEntry {
  id: number;
  /** Milliseconds since the epoch of the latest update to this line. */
  time: number;
  deviceIndex: number;
  device: string;
  kind: InputChange['kind'];
  text: string;
}

/**
 * A readable activity log: one line per button press, release and hat move; a moving axis
 * is one line that keeps updating while the movement goes on ("Z axis moved 12% → 63%"),
 * and wobbles smaller than 2% of the travel are not logged at all.
 */
export class ActivityLog {
  entries: LogEntry[] = [];
  private nextId = 1;
  /** Per device and axis: the open line and the value the movement started at. */
  private moving = new Map<string, { entry: LogEntry; from: number }>();
  /** Per device and axis: the value of the last logged position. */
  private settled = new Map<string, number>();

  constructor(
    private readonly limit = 200,
    /** Axis movement merges into the same line while updates are closer than this. */
    private readonly mergeMs = 700,
    /** Smallest axis movement logged, in -1..1 units (0.04 = 2% of full travel). */
    private readonly minMove = 0.04
  ) {}

  private add(entry: Omit<LogEntry, 'id'>): LogEntry {
    const full = { ...entry, id: this.nextId++ };
    this.entries.unshift(full);
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    return full;
  }

  /**
   * Records the change from `previous` to `next`. Returns the line that best says what
   * happened: a button or hat line before an axis line.
   */
  record(
    device: Pick<InputDevice, 'axisNames'> | undefined,
    deviceName: string,
    previous: InputState | undefined,
    next: InputState,
    now: number
  ): LogEntry | undefined {
    let discrete: LogEntry | undefined;
    let moved: LogEntry | undefined;
    if (previous === undefined) {
      next.axes.forEach((v, i) => this.settled.set(`${next.index}:${i}`, v));
      return undefined;
    }
    for (const change of diffStates(device, previous, next)) {
      if (change.kind !== 'axis') {
        discrete = this.add({
          time: now,
          deviceIndex: next.index,
          device: deviceName,
          kind: change.kind,
          text: change.text,
        });
        continue;
      }
      const key = `${next.index}:${change.index}`;
      const value = change.value as number;
      const open = this.moving.get(key);
      if (open && now - open.entry.time <= this.mergeMs && this.entries.includes(open.entry)) {
        open.entry.time = now;
        open.entry.text = movedText(axisLabel(device, change.index), open.from, value);
        this.settled.set(key, value);
        moved = open.entry;
        continue;
      }
      const from = this.settled.get(key) ?? previous.axes[change.index] ?? value;
      if (Math.abs(value - from) < this.minMove) continue;
      const entry = this.add({
        time: now,
        deviceIndex: next.index,
        device: deviceName,
        kind: 'axis',
        text: movedText(axisLabel(device, change.index), from, value),
      });
      this.moving.set(key, { entry, from });
      this.settled.set(key, value);
      moved = entry;
    }
    return discrete ?? moved;
  }

  clear(): void {
    this.entries = [];
    this.moving.clear();
  }
}

/** An axis must move this far from where it was (in -1..1 units, 0.3 = 15% of travel) to identify a device. */
export const IDENTIFY_AXIS_THRESHOLD = 0.3;

export interface IdentifyHit {
  index: number;
  /** "Button 5", "Hat 1 up", "Z axis". */
  input: string;
}

/**
 * "Press anything": compares a controller's state with the one it had when listening began.
 * A newly pressed button or a hat move wins at once; an axis only when it moved a long way,
 * so a jittery axis or a drifting knob does not.
 */
export function detectIdentify(
  device: Pick<InputDevice, 'axisNames'> | undefined,
  baseline: InputState | undefined,
  state: InputState
): IdentifyHit | undefined {
  const pressed = state.buttons.findIndex((b, i) => b && !(baseline?.buttons[i] ?? false));
  if (pressed >= 0) return { index: state.index, input: buttonLabel(pressed) };
  const hat = state.hats.findIndex(
    (h, i) => hatDirection(h) !== 'centred' && hatDirection(h) !== hatDirection(baseline?.hats[i])
  );
  if (hat >= 0)
    return { index: state.index, input: `${hatLabel(hat)} ${hatDirection(state.hats[hat])}` };
  if (baseline) {
    const axis = state.axes.findIndex(
      (v, i) => Math.abs(v - (baseline.axes[i] ?? v)) >= IDENTIFY_AXIS_THRESHOLD
    );
    if (axis >= 0) return { index: state.index, input: axisLabel(device, axis) };
  }
  return undefined;
}

/** Extent of an axis seen while testing. */
export interface AxisRange {
  min: number;
  max: number;
}

export function widen(range: AxisRange | undefined, value: number): AxisRange {
  return range
    ? { min: Math.min(range.min, value), max: Math.max(range.max, value) }
    : { min: value, max: value };
}

/** An end counts as reached within 2% of the travel. */
const END = 0.96;

/**
 * After the user has swept an axis (it moved across more than half its travel), says
 * whether it falls short of either end: "Reaches 3% to 96%: never gets to its ends".
 * Undefined while there is not enough movement to tell, or when it reaches both ends.
 */
export function rangeShortfall(range: AxisRange | undefined): string | undefined {
  if (!range || range.max - range.min < 1) return undefined;
  const low = range.min > -END;
  const high = range.max < END;
  if (!low && !high) return undefined;
  const span = `${Math.round(axisPercent(range.min))}% to ${Math.round(axisPercent(range.max))}%`;
  const which = low && high ? 'either end' : low ? 'its low end' : 'its high end';
  return `Only reaches ${span}: never gets to ${which}`;
}
