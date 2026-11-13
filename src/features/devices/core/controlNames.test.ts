import { describe, expect, it } from 'vitest';
import type { InputState } from '../../../shared/models';
import { ActivityLog, gameInputLabel } from './input';

describe('what a control does (binding inspector)', () => {
  it('names the control that was used the way the game does: button, hat direction, axis', () => {
    const device = { axisNames: ['X', 'Y', 'RZ'] };
    const log = new ActivityLog();
    const state = (over: Partial<InputState>): InputState => ({
      index: 0,
      name: 'Stick',
      axes: [0, 0, 0],
      buttons: [false, false, false],
      hats: [[0, 0]],
      timestamp: 1,
      ...over,
    });
    const rest = state({});
    log.record(device, 'Stick', undefined, rest, 0);
    expect(
      log.record(device, 'Stick', rest, state({ buttons: [false, false, true] }), 10)?.input
    ).toBe('JOY_BTN3');
    expect(log.record(device, 'Stick', rest, state({ hats: [[1, 1]] }), 20)?.input).toBe(
      'JOY_BTN_POV1_UR'
    );
    // Back to centre is not a control of its own.
    expect(log.record(device, 'Stick', state({ hats: [[1, 1]] }), rest, 30)?.input).toBeUndefined();
    expect(log.record(device, 'Stick', rest, state({ axes: [0, 0, 0.8] }), 2000)?.input).toBe(
      'JOY_RZ'
    );
    expect(log.lastControl).toEqual({ deviceIndex: 0, input: 'JOY_RZ' });
    // A button let go while an axis moves: the axis is what is being used, not the release.
    const held = state({ buttons: [true, false, false], axes: [0, 0, 0.8] });
    log.record(device, 'Stick', state({ axes: [0, 0, 0.8] }), held, 4000);
    expect(log.lastControl?.input).toBe('JOY_BTN1');
    const line = log.record(device, 'Stick', held, state({ axes: [0.9, 0, 0.8] }), 6000);
    expect(line?.text).toBe('Button 1 released');
    expect(log.lastControl?.input).toBe('JOY_X');
    log.record(device, 'Stick', held, state({ axes: [0, 0, 0.8] }), 8000);
    expect(log.lastControl?.input).toBe('JOY_X');
    expect(gameInputLabel('JOY_BTN12')).toBe('Button 12');
    expect(gameInputLabel('JOY_BTN_POV1_UR')).toBe('Hat 1 up-right');
    expect(gameInputLabel('JOY_RZ')).toBe('Z rotation');
    expect(gameInputLabel('JOY_SLIDER1')).toBe('Slider 1');
    expect(gameInputLabel('LShift')).toBe('LShift');
  });
});
