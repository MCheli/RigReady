import { listenForPresses as listenForControllerPresses } from '../../../core/inputPresses';
import type { InputProvider } from '../../../core/ports';

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

/**
 * Reports each new press on any controller until the returned function is called. The
 * detection itself is shared (core/inputPresses.ts): the first state of a device is its
 * resting position, so a switch held on is not a press.
 */
export function listenForPresses(
  input: InputProvider,
  onPress: (press: Press) => void
): () => void {
  return listenForControllerPresses(input, (press) =>
    onPress({
      guid: press.device.guid.replace(/[{}]/g, '').toUpperCase(),
      deviceName: press.device.name,
      input: press.input,
      label: describeInput(press.input)?.label ?? press.input,
      kind: press.kind,
    })
  );
}
