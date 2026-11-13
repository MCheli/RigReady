import { controlFromDirectInput, controlLabel, type BoundDevice } from '../../../core/bindings';
import type { BoundControl, BoundInputs } from '../../../core/boundInputs';
import type { ExamplePress, PressAction } from './model';

/**
 * The lines the preview on the Overlay page shows while the overlay is off, so that the size
 * and the number of lines can be judged before it is turned on. They are examples and the
 * preview marks each of them as one. They are never among the presses (`recent`, `presses`),
 * so they are never in the overlay's own window.
 *
 * Where the game's bindings were read they are the game's own, as a press would show them:
 * two buttons of the controller the user bound the most on. Where there are no bindings to
 * go by, they are what a press shows there: the control and the controller.
 */

/** How many example lines there are at most. */
export const EXAMPLE_LINES = 2;

/** No controller is named that may not be on this PC. */
export const EXAMPLE_DEVICE = 'Your controller';

const PLAIN: readonly ExamplePress[] = [
  { control: 'Button 1', device: EXAMPLE_DEVICE, actions: [], known: false },
  { control: 'Hat 1 up', device: EXAMPLE_DEVICE, actions: [], known: false },
];

/** What a press of a control lists: what works on its own before what needs something held. */
export function pressActions(control: Pick<BoundControl, 'actions'> | undefined): PressAction[] {
  return (control?.actions ?? [])
    .map(({ action, modifiers }) => ({ action, modifiers }))
    .sort((a, b) => Number(a.modifiers.length > 0) - Number(b.modifiers.length > 0));
}

interface Candidate {
  /** The controller is attached. */
  attached: boolean;
  /** The user bound it, and not only the game by itself. */
  own: boolean;
  /** How many buttons and hats of its controller the user bound. */
  ownOnController: number;
  hat: boolean;
  /** Where its controller is in the game's order. */
  controller: number;
  /** The number of the button or of the hat. */
  number: number;
  line: ExamplePress;
}

/** The first that tells two candidates apart decides. */
const ORDER: readonly ((a: Candidate, b: Candidate) => number)[] = [
  // A controller that is attached: it is the one the user can press.
  (a, b) => Number(b.attached) - Number(a.attached),
  // What the user bound, before what the game binds by itself on any controller there is
  // (looking around with the hat of a wheel base, in an aircraft).
  (a, b) => Number(b.own) - Number(a.own),
  // The controller the user bound the most on is the one the game is played with.
  (a, b) => b.ownOnController - a.ownOnController,
  (a, b) => Number(a.hat) - Number(b.hat),
  (a, b) => a.controller - b.controller,
  (a, b) => a.number - b.number,
];

/**
 * `bound` is what was read of the game in use (absent: nothing could be), `devices` the
 * controllers those bindings are for, and `label` what a press of one of them names it.
 */
export function examplePresses(
  bound: BoundInputs | undefined,
  devices: readonly BoundDevice[],
  label: (device: BoundDevice) => string
): ExamplePress[] {
  if (!bound) return [...PLAIN];
  const byGuid = new Map<string, BoundDevice>();
  for (const device of devices) {
    if (device.guid) byGuid.set(device.guid.toUpperCase(), device);
  }
  const found: Candidate[] = [];
  bound.controllers.forEach((controller, at) => {
    const device = byGuid.get(controller.guid);
    if (!device) return;
    const name = label(device);
    const ofController: Candidate[] = [];
    for (const control of controller.controls) {
      const what = controlFromDirectInput(control.input);
      // An axis is never a press, so it is no example of one.
      if (!what || what.kind === 'axis' || control.actions.length === 0) continue;
      ofController.push({
        attached: device.connected,
        own: control.actions.some((action) => action.source === 'user'),
        ownOnController: 0,
        hat: what.kind === 'hat',
        controller: at,
        number: what.kind === 'hat' ? what.hat : what.index,
        line: {
          control: controlLabel(what),
          device: name,
          actions: pressActions(control),
          known: true,
        },
      });
    }
    const own = ofController.filter((candidate) => candidate.own).length;
    for (const candidate of ofController) found.push({ ...candidate, ownOnController: own });
  });
  if (found.length === 0) return [...PLAIN];
  return found
    .sort((a, b) => {
      for (const by of ORDER) {
        const order = by(a, b);
        if (order !== 0) return order;
      }
      return 0;
    })
    .slice(0, EXAMPLE_LINES)
    .map((candidate) => candidate.line);
}
