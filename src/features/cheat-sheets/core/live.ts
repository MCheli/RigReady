import type { InputDevice, InputState } from '../../../shared/models';

/**
 * Live controller state as control ids, so pressing a real control lights up its label.
 * The sidecar reports buttons in DirectInput order (Button 1 is index 0) and hats as
 * [x, y] with y = 1 for up.
 */

const HAT: Record<string, string> = {
  '0,1': 'U',
  '1,1': 'UR',
  '1,0': 'R',
  '1,-1': 'DR',
  '0,-1': 'D',
  '-1,-1': 'DL',
  '-1,0': 'L',
  '-1,1': 'UL',
};

/** The controls that are held right now. */
export function pressedControls(state: Pick<InputState, 'buttons' | 'hats'>): string[] {
  const pressed: string[] = [];
  state.buttons.forEach((down, i) => {
    if (down) pressed.push(`button:${i + 1}`);
  });
  state.hats.forEach((hat, i) => {
    const direction = HAT[`${Math.sign(hat[0])},${Math.sign(hat[1])}`];
    if (direction) pressed.push(`hat:${i + 1}:${direction}`);
  });
  return pressed;
}

/** Axis positions by control id, -1 .. 1. */
export function axisValues(
  device: Pick<InputDevice, 'axisNames'> | undefined,
  state: Pick<InputState, 'axes'>
): Record<string, number> {
  const values: Record<string, number> = {};
  state.axes.forEach((value, i) => {
    const name = device?.axisNames[i];
    if (name)
      values[`axis:${name}`] = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  });
  return values;
}

export interface LiveDevice {
  guid: string;
  pressed: string[];
  axes: Record<string, number>;
  /** Axes that moved noticeably since the state before: worth lighting up. */
  moved: string[];
}

/** Axis travel (of the full -1..1 range) that counts as "the user moved it". */
export const AXIS_MOVE = 0.08;

/** Follows controller states and says what is held and what moved, per controller. */
export class LiveTracker {
  private readonly rest = new Map<number, Record<string, number>>();

  update(device: InputDevice | undefined, state: InputState): LiveDevice | undefined {
    if (!device) return undefined;
    const axes = axisValues(device, state);
    const rest = this.rest.get(state.index);
    const moved: string[] = [];
    if (!rest) {
      this.rest.set(state.index, { ...axes });
    } else {
      for (const [id, value] of Object.entries(axes)) {
        if (Math.abs(value - (rest[id] ?? value)) > AXIS_MOVE) {
          moved.push(id);
          rest[id] = value;
        }
      }
    }
    return { guid: device.guid.toUpperCase(), pressed: pressedControls(state), axes, moved };
  }

  reset(): void {
    this.rest.clear();
  }
}
