import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import {
  ActivityLog,
  axisGameName,
  axisLabel,
  axisPercent,
  axisRaw,
  buttonGameName,
  buttonLabel,
  detectIdentify,
  diffStates,
  hatDirection,
  inputKeyFor,
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
