import { detectPresses } from '../../../core/inputPresses';
import type { InputDevice, InputState } from '../../../shared/models';

/**
 * Turns the live state of the controllers into what the user just did: each button or hat
 * direction that went down, and each that came up. Presses are found by the shared press
 * detection (`src/core/inputPresses.ts`), so an input has the same name here as on every
 * other page; a release is the same question asked backwards.
 *
 * The first state seen of a controller is how it rests: a switch that is on, a lever in its
 * detent or a button held while the overlay starts is not a press. Axes are never reported.
 */

export interface PressChange {
  kind: 'press' | 'release';
  /** The controller, as the input reader lists it now. */
  device: InputDevice;
  /** The input as press detection names it: JOY_BTN5, JOY_BTN_POV1_U. */
  input: string;
}

const keyOf = (of: { index: number; name: string }): string => `${of.index}|${of.name}`;

export class PressTracker {
  /** The last state of each controller, by its place in the list and its name. */
  private readonly last = new Map<string, InputState>();

  /**
   * What changed with these states, in order. Within one state the releases come first: a
   * switch that moved from one position to the next lets go of the one before it takes the
   * other. `devices` is asked only when something did change.
   */
  changes(states: readonly InputState[], devices: () => InputDevice[]): PressChange[] {
    const found: PressChange[] = [];
    let listed: InputDevice[] | undefined;
    for (const state of states) {
      const key = keyOf(state);
      const previous = this.last.get(key);
      this.last.set(key, state);
      // How it rests.
      if (!previous) continue;
      // No axis names: an axis is never a press here.
      const released = detectPresses(previous, state, previous, []);
      const pressed = detectPresses(previous, previous, state, []);
      if (released.length === 0 && pressed.length === 0) continue;
      listed ??= devices();
      const device = listed.find((d) => d.index === state.index && d.name === state.name);
      // Unplugged between the state and now: nothing to say about it.
      if (!device) continue;
      for (const change of released) found.push({ kind: 'release', device, input: change.input });
      for (const change of pressed) found.push({ kind: 'press', device, input: change.input });
    }
    return found;
  }

  /**
   * Forgets the controllers that are not connected any more, so that one plugged in again
   * (perhaps at another place in the list) starts from how it rests then.
   */
  keep(devices: readonly InputDevice[]): void {
    const connected = new Set(devices.map(keyOf));
    for (const key of [...this.last.keys()]) {
      if (!connected.has(key)) this.last.delete(key);
    }
  }

  /** Forgets everything: the next state of each controller is how it rests. */
  reset(): void {
    this.last.clear();
  }
}
