import type { InputProvider } from '../../../core/ports';
import type { InputDevice, InputState } from '../../../shared/models';

/**
 * Controller inputs by the names DCS uses (JOY_BTN5, JOY_BTN_POV1_U, JOY_RZ): what they
 * are called in plain language, whether a device has them, and turning live controller
 * state into "the user just pressed this" for the guided walkthrough.
 */

export type InputKind = 'button' | 'hat' | 'axis';

export interface Controls {
  buttons: number;
  hats: number;
  axes: string[];
}

const HATS: Record<string, string> = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
  UR: 'up-right',
  UL: 'up-left',
  DR: 'down-right',
  DL: 'down-left',
};

const AXES: Record<string, string> = {
  SLIDER1: 'Slider 1',
  SLIDER2: 'Slider 2',
};

export function describeInput(
  key: string
): { kind: InputKind; label: string; number?: number; axis?: string } | undefined {
  const hat = /^JOY_BTN_POV([1-4])_(U|D|L|R|UR|UL|DR|DL)$/.exec(key);
  if (hat) {
    return { kind: 'hat', number: Number(hat[1]), label: `Hat ${hat[1]} ${HATS[hat[2]!]}` };
  }
  const button = /^JOY_BTN([1-9]\d{0,2})$/.exec(key);
  if (button) return { kind: 'button', number: Number(button[1]), label: `Button ${button[1]}` };
  const axis = /^JOY_(X|Y|Z|RX|RY|RZ|SLIDER1|SLIDER2)$/.exec(key);
  if (axis) return { kind: 'axis', axis: axis[1]!, label: AXES[axis[1]!] ?? `${axis[1]} axis` };
  return undefined;
}

/** True when the device has that button, hat direction or axis. */
export function hasInput(controls: Controls, key: string): boolean {
  const info = describeInput(key);
  if (!info) return false;
  if (info.kind === 'button') return (info.number ?? 0) <= controls.buttons;
  if (info.kind === 'hat') return (info.number ?? 0) <= controls.hats;
  return controls.axes.some((a) => a.toUpperCase() === info.axis);
}

/** An axis action needs an axis; a button action takes a button or a hat direction. */
export function fits(actionKind: 'button' | 'axis', key: string): boolean {
  const info = describeInput(key);
  if (!info) return false;
  return actionKind === 'axis' ? info.kind === 'axis' : info.kind !== 'axis';
}

export interface Press {
  /** DirectInput instance GUID, upper case. */
  guid: string;
  deviceName: string;
  input: string;
  label: string;
  kind: InputKind;
}

const HAT_NAMES: Record<string, string> = {
  '0,1': 'U',
  '1,1': 'UR',
  '1,0': 'R',
  '1,-1': 'DR',
  '0,-1': 'D',
  '-1,-1': 'DL',
  '-1,0': 'L',
  '-1,1': 'UL',
};

/** How far an axis must move from where it rested (full travel is 2) to count. */
const AXIS_TRAVEL = 0.5;

/** The inputs that became active between two states; `rest` is where the device started. */
export function pressedBetween(
  rest: InputState,
  previous: InputState,
  next: InputState,
  axisNames: string[]
): { input: string; kind: InputKind }[] {
  const found: { input: string; kind: InputKind }[] = [];
  next.buttons.forEach((down, i) => {
    if (down && !previous.buttons[i]) found.push({ input: `JOY_BTN${i + 1}`, kind: 'button' });
  });
  next.hats.forEach((hat, i) => {
    const before = previous.hats[i] ?? [0, 0];
    const name = HAT_NAMES[`${hat[0]},${hat[1]}`];
    if (name && (before[0] !== hat[0] || before[1] !== hat[1])) {
      found.push({ input: `JOY_BTN_POV${i + 1}_${name}`, kind: 'hat' });
    }
  });
  next.axes.forEach((value, i) => {
    const name = axisNames[i];
    if (!name) return;
    const origin = rest.axes[i] ?? 0;
    const was = Math.abs((previous.axes[i] ?? origin) - origin) >= AXIS_TRAVEL;
    if (!was && Math.abs(value - origin) >= AXIS_TRAVEL) {
      found.push({ input: `JOY_${name.toUpperCase()}`, kind: 'axis' });
    }
  });
  return found;
}

/**
 * Reports each new press on any controller until the returned function is called. The
 * first state of a device is its resting position: a switch held on is not a press.
 */
export function listenForPresses(
  input: InputProvider,
  onPress: (press: Press) => void
): () => void {
  const rest = new Map<number, InputState>();
  const last = new Map<number, InputState>();
  return input.subscribe((states) => {
    const devices: InputDevice[] = input.devices();
    for (const state of states) {
      const device = devices.find((d) => d.index === state.index && d.name === state.name);
      if (!device) continue;
      const resting = rest.get(state.index);
      const previous = last.get(state.index);
      last.set(state.index, state);
      if (!resting || !previous) {
        rest.set(state.index, state);
        continue;
      }
      for (const found of pressedBetween(resting, previous, state, device.axisNames)) {
        onPress({
          guid: device.guid.replace(/[{}]/g, '').toUpperCase(),
          deviceName: device.name,
          input: found.input,
          label: describeInput(found.input)?.label ?? found.input,
          kind: found.kind,
        });
      }
    }
  });
}
