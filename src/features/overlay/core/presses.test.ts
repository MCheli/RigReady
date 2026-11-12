import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import { PressTracker } from './presses';

const device = (index: number, name: string): InputDevice => ({
  index,
  name,
  guid: `0000000${index}-0000-0000-0000-000000000000`,
  productGuid: '',
  vendorId: '4098',
  productId: 'BEA8',
  numAxes: 2,
  numButtons: 8,
  numHats: 1,
  axisNames: ['X', 'Y'],
});

const STICK = device(0, 'Stick');
const THROTTLE = device(1, 'Throttle');
const devices = (): InputDevice[] => [STICK, THROTTLE];

/** A state with these buttons (1-based) down and the hat where it is said to be. */
function state(
  of: InputDevice,
  down: number[] = [],
  hat: [number, number] = [0, 0],
  axes: number[] = [0, 0]
): InputState {
  const buttons = Array.from({ length: of.numButtons }, (_, i) => down.includes(i + 1));
  return { index: of.index, name: of.name, axes, buttons, hats: [hat], timestamp: 0 };
}

const said = (tracker: PressTracker, states: InputState[]): string[] =>
  tracker.changes(states, devices).map((c) => `${c.kind} ${c.input} on ${c.device.name}`);

describe('what the user just did, from the live state of the controllers', () => {
  it('the first state of a controller is how it rests: a switch that is on is not a press', () => {
    const tracker = new PressTracker();
    // A three-way switch in its middle position and a lever in its detent hold buttons down.
    expect(said(tracker, [state(THROTTLE, [3, 7])])).toEqual([]);
    // Nothing moved.
    expect(said(tracker, [state(THROTTLE, [3, 7])])).toEqual([]);
  });

  it('a button that goes down is a press, and one that comes up a release', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK)]);
    expect(said(tracker, [state(STICK, [2])])).toEqual(['press JOY_BTN2 on Stick']);
    expect(said(tracker, [state(STICK, [2])])).toEqual([]);
    expect(said(tracker, [state(STICK)])).toEqual(['release JOY_BTN2 on Stick']);
  });

  it('a switch that moves to its next position lets go of the one before it takes the other', () => {
    const tracker = new PressTracker();
    said(tracker, [state(THROTTLE, [3])]);
    expect(said(tracker, [state(THROTTLE, [4])])).toEqual([
      'release JOY_BTN3 on Throttle',
      'press JOY_BTN4 on Throttle',
    ]);
  });

  it('a hat is a press of the direction it went to and a release of the one it left', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK)]);
    expect(said(tracker, [state(STICK, [], [0, 1])])).toEqual(['press JOY_BTN_POV1_U on Stick']);
    // Rolled on to up-right without passing the middle.
    expect(said(tracker, [state(STICK, [], [1, 1])])).toEqual([
      'release JOY_BTN_POV1_U on Stick',
      'press JOY_BTN_POV1_UR on Stick',
    ]);
    expect(said(tracker, [state(STICK, [], [0, 0])])).toEqual(['release JOY_BTN_POV1_UR on Stick']);
  });

  it('an axis is never a press, however far it travels', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK)]);
    expect(said(tracker, [state(STICK, [], [0, 0], [1, -1])])).toEqual([]);
  });

  it('each controller is followed by itself, several in one delivery', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK), state(THROTTLE, [3])]);
    expect(said(tracker, [state(STICK, [1]), state(THROTTLE, [3, 5])])).toEqual([
      'press JOY_BTN1 on Stick',
      'press JOY_BTN5 on Throttle',
    ]);
  });

  it('asks which controllers there are only when something changed', () => {
    const tracker = new PressTracker();
    let asked = 0;
    const counting = (): InputDevice[] => {
      asked += 1;
      return devices();
    };
    tracker.changes([state(STICK), state(THROTTLE)], counting);
    tracker.changes([state(STICK, [], [0, 0], [0.3, 0.1])], counting);
    expect(asked).toBe(0);
    tracker.changes([state(STICK, [1]), state(THROTTLE, [2])], counting);
    expect(asked).toBe(1);
  });

  it('says nothing about a controller that is not listed any more', () => {
    const tracker = new PressTracker();
    tracker.changes([state(STICK)], devices);
    expect(tracker.changes([state(STICK, [1])], () => [THROTTLE])).toEqual([]);
  });

  it('a controller that was unplugged starts again from how it rests when it is back', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK), state(THROTTLE)]);
    tracker.keep([STICK]);
    // Plugged in again with a switch on: that is rest, not a press.
    expect(said(tracker, [state(THROTTLE, [6])])).toEqual([]);
    // The stick was kept: it goes on from where it was.
    expect(said(tracker, [state(STICK, [1])])).toEqual(['press JOY_BTN1 on Stick']);
  });

  it('after a reset everything that is held is rest again', () => {
    const tracker = new PressTracker();
    said(tracker, [state(STICK)]);
    tracker.reset();
    expect(said(tracker, [state(STICK, [4])])).toEqual([]);
    expect(said(tracker, [state(STICK, [4, 5])])).toEqual(['press JOY_BTN5 on Stick']);
  });
});
