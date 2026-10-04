import { afterEach, describe, expect, it } from 'vitest';
import type { InputState } from '../../../shared/models';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { describeInput, fits, hasInput, listenForPresses, type Press } from './inputs';

let app: WiredApp;
afterEach(() => app?.cleanup());

const controls = { buttons: 12, hats: 1, axes: ['X', 'Y', 'SLIDER1'] };

describe('controller inputs by their DCS names', () => {
  it('names buttons, hat directions and axes in plain language and knows which a device has', () => {
    expect(describeInput('JOY_BTN5')).toMatchObject({ kind: 'button', label: 'Button 5' });
    expect(describeInput('JOY_BTN_POV1_UR')).toMatchObject({
      kind: 'hat',
      label: 'Hat 1 up-right',
    });
    expect(describeInput('JOY_RZ')).toMatchObject({ kind: 'axis', label: 'RZ axis' });
    expect(describeInput('JOY_SLIDER1')).toMatchObject({ kind: 'axis', label: 'Slider 1' });
    expect(describeInput('LShift')).toBeUndefined();
    expect(describeInput('JOY_BTN0')).toBeUndefined();
    expect(describeInput('../evil')).toBeUndefined();
    expect(hasInput(controls, 'JOY_BTN12')).toBe(true);
    expect(hasInput(controls, 'JOY_BTN13')).toBe(false);
    expect(hasInput(controls, 'JOY_BTN_POV2_U')).toBe(false);
    expect(hasInput(controls, 'JOY_SLIDER1')).toBe(true);
    expect(hasInput(controls, 'JOY_RZ')).toBe(false);
    expect(hasInput(controls, 'nonsense')).toBe(false);
    expect(fits('axis', 'JOY_X')).toBe(true);
    expect(fits('axis', 'JOY_BTN1')).toBe(false);
    expect(fits('button', 'JOY_BTN_POV1_U')).toBe(true);
    expect(fits('button', 'JOY_Y')).toBe(false);
    expect(fits('button', 'what')).toBe(false);
  });

  it('reports a press, a hat direction and an axis moved from where it rested, but not the resting state', async () => {
    app = await wiredApp('dcs-bindings-hornet', { files: [] });
    const stick = app.ports.input.devices().find((d) => d.name.includes('Orion'))!;
    const presses: Press[] = [];
    const stop = listenForPresses(app.ports.input, (p) => presses.push(p));
    const state = (patch: Partial<InputState>): InputState => ({
      index: stick.index,
      name: stick.name,
      axes: stick.axisNames.map(() => 0),
      buttons: Array.from({ length: stick.numButtons }, () => false),
      hats: [[0, 0]],
      timestamp: 0,
      ...patch,
    });
    // The first state is the resting position: a button held down then is not a press.
    const held = Array.from({ length: stick.numButtons }, (_, i) => i === 0);
    app.ports.input.emit([state({ buttons: held })]);
    app.ports.input.emit([state({ buttons: held.map((v, i) => v || i === 4) })]);
    app.ports.input.emit([state({ hats: [[0, -1]] })]);
    app.ports.input.emit([state({ axes: stick.axisNames.map((_, i) => (i === 0 ? 0.9 : 0)) })]);
    // An unknown device is ignored.
    app.ports.input.emit([{ ...state({}), index: 99, name: 'Ghost' }]);
    stop();
    app.ports.input.emit([state({ buttons: held.map((v, i) => v || i === 7) })]);
    expect(presses.map((p) => [p.input, p.label, p.kind])).toEqual([
      ['JOY_BTN5', 'Button 5', 'button'],
      ['JOY_BTN_POV1_D', 'Hat 1 down', 'hat'],
      ['JOY_X', 'X axis', 'axis'],
    ]);
    expect(presses[0]!.guid).toBe(stick.guid.toUpperCase());
  });
});
