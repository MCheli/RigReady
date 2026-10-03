import { dcsGuidText } from '../../../core/directInput';
import type { InputProvider } from '../../../core/ports';
import type { InputDevice, InputState } from '../../../shared/models';
import { describeInput } from './names';

/**
 * "Press the control": turns live controller state into the DCS name of the input the
 * user just used. The first state seen for a device is its resting position, so a
 * switch that is held on, or a throttle that is not centred, does not count as a press.
 */

export interface PressedInput {
  /** The device's instance GUID in DCS's casing. */
  guid: string;
  deviceName: string;
  /** DCS event name: JOY_BTN5, JOY_BTN_POV1_U, JOY_RZ. */
  key: string;
  /** "Button 5". */
  label: string;
  kind: 'button' | 'hat' | 'axis';
}

/** How far an axis must travel from where it rested (full travel is 2) to count as "moved". */
const AXIS_TRAVEL = 0.5;

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
export function detectInputs(
  rest: InputState,
  previous: InputState,
  next: InputState,
  device: Pick<InputDevice, 'axisNames'>
): { key: string; kind: PressedInput['kind'] }[] {
  const found: { key: string; kind: PressedInput['kind'] }[] = [];
  next.buttons.forEach((down, index) => {
    if (down && !previous.buttons[index])
      found.push({ key: `JOY_BTN${index + 1}`, kind: 'button' });
  });
  next.hats.forEach((hat, index) => {
    const before = previous.hats[index] ?? [0, 0];
    const name = HAT_NAMES[`${hat[0]},${hat[1]}`];
    if (name && (before[0] !== hat[0] || before[1] !== hat[1])) {
      found.push({ key: `JOY_BTN_POV${index + 1}_${name}`, kind: 'hat' });
    }
  });
  next.axes.forEach((value, index) => {
    const name = device.axisNames[index];
    if (!name) return;
    const origin = rest.axes[index] ?? 0;
    const was = Math.abs((previous.axes[index] ?? origin) - origin) >= AXIS_TRAVEL;
    if (!was && Math.abs(value - origin) >= AXIS_TRAVEL) {
      found.push({ key: `JOY_${name.toUpperCase()}`, kind: 'axis' });
    }
  });
  return found;
}

/** Listens to the InputProvider and reports each new press. Call the returned function to stop. */
export function listenForInput(
  input: InputProvider,
  onPressed: (pressed: PressedInput) => void
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
      for (const found of detectInputs(resting, previous, state, device)) {
        onPressed({
          guid: dcsGuidText(device.guid),
          deviceName: device.name,
          key: found.key,
          label: describeInput(found.key).label,
          kind: found.kind,
        });
      }
    }
  });
}
