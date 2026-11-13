import { drawingFor, type PhysicalControl } from './drawings';
import { knownDeviceFor } from './known';
import { pictureFor, type PictureDevice } from './picture';

/**
 * Which buttons of a device are positions of one physical control: the IDLE and OFF stops
 * of a throttle handle, the two or three positions of a switch, the steps of a knob. The
 * trainer needs it to tell a position a control stays in from a press (see trainerRound).
 *
 * It is read from the device's drawing (the one its sheet is drawn with, else RigReady's
 * own), else from the map of a known device. Neither says which positions stay put without
 * a hand: a drawing groups the inputs of each control and says what the control looks like.
 * So this only says which buttons belong together, and leaves out what is drawn as a hat, a
 * mini-stick, a lever or trigger, a button or a key, whose positions spring back. The
 * trainer adds the rest from what it sees: a position that is held while nobody touches the
 * controls is where its control rests.
 */

/** What is drawn this way springs back when it is let go. */
const SPRINGS: readonly PhysicalControl['glyph'][] = ['hat', 'stick', 'lever', 'button', 'key'];

const buttons = (inputs: readonly { id: string }[]): string[] =>
  inputs.map((input) => input.id).filter((id) => id.startsWith('button:'));

/**
 * For every button that shares its control with other buttons, those other buttons:
 * `button:31` (IDLE of the left handle) gives `['button:2']` (its OFF).
 */
export function otherPositions(
  device: Omit<PictureDevice, 'controls' | 'reports'>
): Map<string, string[]> {
  const picture = pictureFor(device);
  const drawing = picture.kind === 'drawing' ? picture.drawing : drawingFor(device);
  const groups = drawing
    ? drawing.controls.filter((c) => !SPRINGS.includes(c.glyph)).map((c) => buttons(c.inputs))
    : (knownDeviceFor(device)?.controls.map((c) => buttons(c.inputs)) ?? []);
  const others = new Map<string, Set<string>>();
  for (const group of groups) {
    if (group.length < 2) continue;
    for (const id of group) {
      const known = others.get(id) ?? new Set<string>();
      for (const other of group) if (other !== id) known.add(other);
      others.set(id, known);
    }
  }
  return new Map([...others].map(([id, set]) => [id, [...set]]));
}
