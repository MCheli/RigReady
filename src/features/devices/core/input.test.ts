import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import {
  ActivityLog,
  axisGameName,
  axisLabel,
  axisPercent,
  axisRaw,
  axisWindowsLabel,
  buttonGameName,
  buttonLabel,
  detectIdentify,
  diffStates,
  hatDirection,
  inputKeyFor,
  NO_CONTROLLER,
  rangeShortfall,
  widen,
} from './input';

const throttle: InputDevice = {
  index: 10,
  name: 'WINWING THROTTLE BASE1',
  guid: 'G-10',
  productGuid: '',
  vendorId: '4098',
  productId: 'BD26',
  numAxes: 3,
  numButtons: 16,
  numHats: 1,
  axisNames: ['X', 'Z', 'SLIDER1'],
};
const state = (over: Partial<InputState> = {}): InputState => ({
  index: 10,
  name: 'WINWING THROTTLE BASE1',
  axes: [0, 0, 0],
  buttons: Array.from({ length: 16 }, () => false),
  hats: [[0, 0]],
  timestamp: 0,
  ...over,
});
const press = (...buttons: number[]): boolean[] =>
  Array.from({ length: 16 }, (_, i) => buttons.includes(i + 1));

/** A wheel base whose axes the maker names (the shape the recorded rig has). */
const dd2: InputDevice = {
  index: 0,
  name: 'FANATEC Podium Wheel Base DD2',
  guid: 'G-0',
  productGuid: '',
  vendorId: '0EB7',
  productId: '0007',
  numAxes: 8,
  numButtons: 108,
  numHats: 1,
  axisNames: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'],
};

describe('input as a game sees it', () => {
  it('shows a 16-bit raw value next to the percent: the centre reads 32767 and 50%', () => {
    expect(axisRaw(0)).toBe(32767);
    expect(axisPercent(0)).toBe(50);
    expect(axisRaw(-1)).toBe(0);
    expect(axisRaw(1)).toBe(65535);
    expect(axisRaw(Number.NaN)).toBe(32767);
    expect(axisRaw(7)).toBe(65535);
    expect(axisPercent(-1)).toBe(0);
    expect(axisPercent(0.5)).toBe(75);
  });

  it('numbers buttons and names axes the way games do', () => {
    expect(buttonLabel(0)).toBe('Button 1');
    expect(buttonGameName(11)).toBe('JOY_BTN12');
    expect(axisLabel(throttle, 1)).toBe('Z axis');
    expect(axisLabel(throttle, 2)).toBe('Slider 1');
    expect(axisLabel(undefined, 4)).toBe('Axis 5');
    expect(axisLabel({ axisNames: ['DIAL'] }, 0)).toBe('DIAL');
    expect(axisGameName(throttle, 1)).toBe('JOY_Z');
    expect(axisGameName(undefined, 0)).toBe('JOY_AXIS1');
    expect(hatDirection([0, 1])).toBe('up');
    expect(hatDirection([-1, -1])).toBe('down-left');
    expect(hatDirection(undefined)).toBe('centred');
  });

  it('calls the axes of a wheel base what its maker calls them, with the Windows name at hand', () => {
    expect(dd2.axisNames.map((_, i) => axisLabel(dd2, i))).toEqual([
      'Wheel',
      'Combined pedals',
      'Accelerator',
      'X rotation',
      'Y rotation',
      'Brake',
      'Clutch',
      'Dial',
    ]);
    expect(axisWindowsLabel(dd2, 0)).toBe('X axis');
    expect(axisWindowsLabel(dd2, 6)).toBe('Slider 1');
    // A game reads the same inputs, whatever the tester calls them.
    expect(axisGameName(dd2, 0)).toBe('JOY_X');
    expect(axisGameName(dd2, 5)).toBe('JOY_RZ');
    // The same axes on anything that is not such a base keep Windows' names: another
    // maker's controller, and the same maker's pedals on their own USB lead.
    expect(axisLabel({ ...dd2, vendorId: '4098', productId: 'BD26' }, 0)).toBe('X axis');
    expect(axisLabel({ ...dd2, productId: '183B' }, 2)).toBe('Z axis');
    expect(axisLabel({ axisNames: dd2.axisNames }, 0)).toBe('X axis');
  });

  it('keys a controller by model and position, so a changed instance GUID does not lose it', () => {
    const a = { ...throttle, guid: 'B' };
    const b = { ...throttle, guid: 'A', index: 11 };
    expect(inputKeyFor(a, [a, b])).toBe('4098:BD26#2');
    expect(inputKeyFor(b, [a, b])).toBe('4098:BD26#1');
    expect(inputKeyFor({ ...throttle, vendorId: '', guid: 'abc' }, [])).toBe('guid:ABC');
  });

  it('lists what changed between two states', () => {
    const before = state();
    const after = state({ buttons: press(12), hats: [[1, 0]], axes: [0, 0.5, 0] });
    expect(diffStates(throttle, before, after).map((c) => c.text)).toEqual([
      'Button 12 pressed',
      'Hat 1 right',
      'Z axis 75%',
    ]);
    expect(diffStates(throttle, after, state()).map((c) => c.text)).toEqual([
      'Button 12 released',
      'Hat 1 centred',
      'Z axis 50%',
    ]);
    expect(diffStates(throttle, before, state({ axes: [0.001, 0, 0] }), 0.01)).toEqual([]);
    expect(diffStates(throttle, undefined, state({ buttons: press(1) }))).toHaveLength(1);
  });
});

describe('activity log', () => {
  it('writes presses as lines and an axis sweep as one line that follows it', () => {
    const log = new ActivityLog();
    expect(log.record(throttle, 'Throttle', undefined, state(), 0)).toBeUndefined();
    let previous = state();
    for (let step = 0; step <= 10; step++) {
      const next = state({ axes: [0, -1 + step * 0.2, 0] });
      log.record(throttle, 'Throttle', previous, next, 1000 + step * 50);
      previous = next;
    }
    expect(log.entries.map((e) => e.text)).toEqual(['Z axis moved 50% → 100%']);

    const pressed = state({ axes: previous.axes, buttons: press(12) });
    expect(log.record(throttle, 'Throttle', previous, pressed, 1600)?.text).toBe(
      'Button 12 pressed'
    );
    // A button line wins over the axis line updated in the same state.
    const both = state({ axes: [0, 0, 0], buttons: press() });
    expect(log.record(throttle, 'Throttle', pressed, both, 1650)?.text).toBe('Button 12 released');
    expect(log.entries[2]!.text).toBe('Z axis moved and came back to 50%');
    expect(log.entries).toHaveLength(3);
  });

  it('ignores small wobbles, starts a new line after a pause, and keeps a bounded history', () => {
    const log = new ActivityLog(3, 700, 0.04);
    const s0 = state();
    log.record(throttle, 'T', undefined, s0, 0);
    expect(log.record(throttle, 'T', s0, state({ axes: [0.02, 0, 0] }), 10)).toBeUndefined();
    expect(log.entries).toHaveLength(0);
    const s1 = state({ axes: [0.5, 0, 0] });
    log.record(throttle, 'T', state({ axes: [0.02, 0, 0] }), s1, 20);
    const s2 = state({ axes: [-0.5, 0, 0] });
    log.record(throttle, 'T', s1, s2, 5000);
    expect(log.entries.map((e) => e.text)).toEqual([
      'X axis moved 75% → 25%',
      'X axis moved 50% → 75%',
    ]);
    for (let i = 1; i <= 4; i++) {
      log.record(throttle, 'T', state(), state({ buttons: press(i) }), 6000 + i);
    }
    expect(log.entries).toHaveLength(3);
    log.clear();
    expect(log.entries).toEqual([]);
  });

  it('writes a wheel under the names of its axes', () => {
    const log = new ActivityLog();
    const wheel = (axes: number[]): InputState => ({
      index: 0,
      name: dd2.name,
      axes,
      buttons: [],
      hats: [],
      timestamp: 0,
    });
    const rest = wheel([0, 0, -1, 0, 0, -1, -1, 0]);
    log.record(dd2, 'Wheel base', undefined, rest, 0);
    const turned = wheel([0.5, 0, -1, 0, 0, -1, -1, 0]);
    expect(log.record(dd2, 'Wheel base', rest, turned, 100)?.text).toBe('Wheel moved 50% → 75%');
    const braking = wheel([0.5, 0, -1, 0, 0, 1, -1, 0]);
    expect(log.record(dd2, 'Wheel base', turned, braking, 2000)?.text).toBe(
      'Brake moved 0% → 100%'
    );
    // What a game would be told is unchanged.
    expect(log.lastControl).toEqual({ deviceIndex: 0, input: 'JOY_RZ' });
  });

  it('never passes the lines of one controller on to the next one with its number', () => {
    const log = new ActivityLog();
    const s0 = state();
    log.record(throttle, 'Throttle', undefined, s0, 0);
    const moved = state({ axes: [0.5, 0, 0] });
    log.record(throttle, 'Throttle', s0, moved, 100);
    log.record(throttle, 'Throttle', moved, state({ axes: [0.5, 0, 0], buttons: press(3) }), 150);
    expect(log.lastControl).toEqual({ deviceIndex: 10, input: 'JOY_BTN3' });

    // The throttle is unplugged and another controller gets number 10.
    log.vacate(10);
    // Its lines stay as the record they are, under the name they were written with ...
    expect(log.entries.map((e) => [e.device, e.text])).toEqual([
      ['Throttle', 'Button 3 pressed'],
      ['Throttle', 'X axis moved 50% → 75%'],
    ]);
    // ... but belong to no number any more, and neither does the control used last.
    expect(log.entries.every((e) => e.deviceIndex === NO_CONTROLLER)).toBe(true);
    expect(log.lastControl).toBeUndefined();

    // The newcomer starts from where it is: its movement is a line of its own, measured
    // from its own position, not a continuation of the line the throttle left open.
    const first = state({ axes: [-1, 0, 0] });
    expect(log.record(dd2, 'Wheel base', undefined, first, 200)).toBeUndefined();
    const line = log.record(dd2, 'Wheel base', first, state({ axes: [0, 0, 0] }), 250);
    expect(line).toMatchObject({
      device: 'Wheel base',
      deviceIndex: 10,
      text: 'Wheel moved 0% → 50%',
    });
    expect(log.entries).toHaveLength(3);
    expect(log.entries[2]).toMatchObject({ device: 'Throttle', text: 'X axis moved 50% → 75%' });
  });
});

describe('find a device by pressing something', () => {
  it('takes a new button press or hat move at once', () => {
    const base = state({ buttons: press(3) });
    expect(detectIdentify(throttle, base, state({ buttons: press(3) }))).toBeUndefined();
    expect(detectIdentify(throttle, base, state({ buttons: press(3, 5) }))).toEqual({
      index: 10,
      input: 'Button 5',
    });
    expect(detectIdentify(throttle, base, state({ buttons: press(3), hats: [[0, -1]] }))).toEqual({
      index: 10,
      input: 'Hat 1 down',
    });
    expect(detectIdentify(throttle, undefined, state({ buttons: press(1) }))?.input).toBe(
      'Button 1'
    );
  });

  it('ignores a jittery axis and takes only a large axis move', () => {
    const base = state();
    let noisy: InputState = base;
    for (const v of [0.05, -0.08, 0.12, -0.1, 0.2, -0.15]) {
      noisy = state({ axes: [0, v, 0] });
      expect(detectIdentify(throttle, base, noisy)).toBeUndefined();
    }
    expect(detectIdentify(throttle, base, state({ axes: [0, 0.45, 0] }))).toEqual({
      index: 10,
      input: 'Z axis',
    });
    expect(detectIdentify(throttle, undefined, state({ axes: [0, 0.9, 0] }))).toBeUndefined();
  });
});

describe('axis range sweep', () => {
  it('says when a swept axis never reaches an end', () => {
    expect(rangeShortfall(undefined)).toBeUndefined();
    expect(rangeShortfall({ min: -0.2, max: 0.3 })).toBeUndefined();
    expect(rangeShortfall({ min: -1, max: 1 })).toBeUndefined();
    expect(rangeShortfall({ min: -0.98, max: 0.97 })).toBeUndefined();
    expect(rangeShortfall({ min: -0.9, max: 0.9 })).toBe(
      'Only reaches 5% to 95%: never gets to either end'
    );
    expect(rangeShortfall({ min: -1, max: 0.8 })).toBe(
      'Only reaches 0% to 90%: never gets to its high end'
    );
    expect(rangeShortfall({ min: -0.5, max: 1 })).toBe(
      'Only reaches 25% to 100%: never gets to its low end'
    );
    expect(widen(widen(undefined, 0.2), -0.4)).toEqual({ min: -0.4, max: 0.2 });
  });
});
