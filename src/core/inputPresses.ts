import type { InputProvider } from './ports';
import type { InputDevice, InputState } from '../shared/models';

/**
 * "Press the control": turns live controller state into the input the user just used,
 * by the names DCS gives inputs (JOY_BTN5, JOY_BTN_POV1_U, JOY_RZ). The first state seen
 * for a device is its resting position, so a switch that is held on, or a throttle that
 * is not centred, does not count as a press. Shared by every feature that binds by
 * pressing (the bindings pages, the binding guide's walkthrough).
 */

export type PressKind = 'button' | 'hat' | 'axis';

export interface DetectedPress {
  /** JOY_BTN5, JOY_BTN_POV1_U, JOY_RZ. */
  input: string;
  kind: PressKind;
}

export interface ControllerPress extends DetectedPress {
  /** The controller it was pressed on, as the InputProvider lists it. */
  device: InputDevice;
}

/** How far an axis must travel from where it rested (full travel is 2) to count as "moved". */
export const AXIS_TRAVEL = 0.5;

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

/** The inputs that went from rest to active between two states of one device. */
export function detectPresses(
  rest: InputState,
  previous: InputState,
  next: InputState,
  axisNames: string[]
): DetectedPress[] {
  const found: DetectedPress[] = [];
  next.buttons.forEach((down, index) => {
    if (down && !previous.buttons[index]) {
      found.push({ input: `JOY_BTN${index + 1}`, kind: 'button' });
    }
  });
  next.hats.forEach((hat, index) => {
    const before = previous.hats[index] ?? [0, 0];
    const name = HAT_NAMES[`${hat[0]},${hat[1]}`];
    if (name && (before[0] !== hat[0] || before[1] !== hat[1])) {
      found.push({ input: `JOY_BTN_POV${index + 1}_${name}`, kind: 'hat' });
    }
  });
  next.axes.forEach((value, index) => {
    const name = axisNames[index];
    if (!name) return;
    const origin = rest.axes[index] ?? 0;
    const was = Math.abs((previous.axes[index] ?? origin) - origin) >= AXIS_TRAVEL;
    if (!was && Math.abs(value - origin) >= AXIS_TRAVEL) {
      found.push({ input: `JOY_${name.toUpperCase()}`, kind: 'axis' });
    }
  });
  return found;
}

/** Listens to the InputProvider and reports each new press. Call the returned function to stop. */
export function listenForPresses(
  input: InputProvider,
  onPress: (press: ControllerPress) => void
): () => void {
  const rest = new Map<number, InputState>();
  const last = new Map<number, InputState>();
  return input.subscribe((states) => {
    const devices = input.devices();
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
      for (const found of detectPresses(resting, previous, state, device.axisNames)) {
        onPress({ ...found, device });
      }
    }
  });
}
