import { dcsGuidText } from '../../../core/directInput';
import { detectPresses, listenForPresses } from '../../../core/inputPresses';
import type { InputProvider } from '../../../core/ports';
import type { InputDevice, InputState } from '../../../shared/models';
import { describeInput } from './names';

/**
 * "Press the control" for the bindings pages: the shared detection (core/inputPresses.ts)
 * with the device's GUID in DCS's casing and the input's name as these pages show it.
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

/** The inputs that went from rest to active between two states of one device. */
export function detectInputs(
  rest: InputState,
  previous: InputState,
  next: InputState,
  device: Pick<InputDevice, 'axisNames'>
): { key: string; kind: PressedInput['kind'] }[] {
  return detectPresses(rest, previous, next, device.axisNames).map((found) => ({
    key: found.input,
    kind: found.kind,
  }));
}

/** Listens to the InputProvider and reports each new press. Call the returned function to stop. */
export function listenForInput(
  input: InputProvider,
  onPressed: (pressed: PressedInput) => void
): () => void {
  return listenForPresses(input, (press) =>
    onPressed({
      guid: dcsGuidText(press.device.guid),
      deviceName: press.device.name,
      key: press.input,
      label: describeInput(press.input).label,
      kind: press.kind,
    })
  );
}
