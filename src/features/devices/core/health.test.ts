import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import { analyzeHealth, looksLikePanel, type Sample } from './health';

const controller = (index: number, over: Partial<InputDevice> = {}): InputDevice => ({
  index,
  name: `Controller ${index}`,
  guid: `G-${index}`,
  productGuid: '',
  vendorId: '4098',
  productId: `BE0${index}`,
  numAxes: 3,
  numButtons: 8,
  numHats: 1,
  axisNames: ['X', 'Y', 'Z'],
  ...over,
});
const stick = controller(1);
const panel = controller(3, {
  name: 'WINWING F18 STARTUP PANEL',
  numAxes: 2,
  numButtons: 57,
  numHats: 0,
  axisNames: ['RX', 'RY'],
});

const at = (t: number, device: InputDevice, over: Partial<InputState> = {}): Sample => ({
  t,
  state: {
    index: device.index,
    name: device.name,
    axes: Array.from({ length: device.numAxes }, () => 0),
    buttons: Array.from({ length: device.numButtons }, () => false),
    hats: Array.from({ length: device.numHats }, (): [number, number] => [0, 0]),
    timestamp: t,
    ...over,
  },
});
const press = (device: InputDevice, ...buttons: number[]): boolean[] =>
  Array.from({ length: device.numButtons }, (_, i) => buttons.includes(i + 1));

const scan = (samples: Sample[], expected?: Set<string>) =>
  analyzeHealth({
    devices: [stick, panel],
    samples,
    start: 0,
    end: 10_000,
    ...(expected ? { expected } : {}),
  });

describe('hands-off health scan', () => {
  it('reports nothing on a quiet rig', () => {
    expect(scan([at(0, stick), at(0, panel)])).toEqual({
      seconds: 10,
      devicesChecked: 2,
      findings: [],
    });
    expect(scan([]).findings).toEqual([]);
  });

  it('reports a button held the whole time as stuck on a stick and as a switch on a panel', () => {
    const report = scan([
      at(0, stick, { buttons: press(stick, 2) }),
      at(0, panel, { buttons: press(panel, 3) }),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'stuck',
        device: 'Controller 1',
        input: 'Button 2',
        button: 1,
        detail: 'Held down for the whole 10 s test',
      }),
      expect.objectContaining({
        kind: 'switch',
        device: 'WINWING F18 STARTUP PANEL',
        input: 'Button 3',
        button: 2,
        inputKey: '4098:BE03#1',
      }),
    ]);
    expect(looksLikePanel(panel)).toBe(true);
    expect(looksLikePanel(stick)).toBe(false);
  });

  it('lists a switch marked as normally on apart, and uses the names the user gave', () => {
    const report = analyzeHealth({
      devices: [panel],
      samples: [at(0, panel, { buttons: press(panel, 3) })],
      start: 0,
      end: 10_000,
      expected: new Set(['4098:BE03#1/2']),
      names: new Map([[3, 'Startup panel']]),
    });
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: 'expected', device: 'Startup panel', input: 'Button 3' }),
    ]);
  });

  it('reports a button pressed and held part of the time for longer than 5 s, and short presses as rogue', () => {
    const report = scan([
      at(0, stick),
      at(2000, stick, { buttons: press(stick, 4) }),
      at(8000, stick),
      at(8500, stick, { buttons: press(stick, 6) }),
      at(8600, stick),
      at(9000, stick, { buttons: press(stick, 6) }),
      at(9100, stick),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: 'stuck', input: 'Button 4', detail: 'Held down for 6 s' }),
      expect.objectContaining({
        kind: 'rogue',
        input: 'Button 6',
        detail: 'Pressed 2 times and released 2 times with nobody touching it',
      }),
    ]);
  });

  it('reports an axis that wanders more than 1% of its travel as noisy, with the spread', () => {
    const report = scan([
      at(0, stick),
      at(1000, stick, { axes: [0, 0, 0.02] }),
      at(2000, stick, { axes: [0, 0.008, -0.03] }),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'noisy',
        input: 'Z axis',
        spread: 2.5,
        detail: 'Wandered over 2.5% of its travel while untouched (more than 1% is noisy)',
      }),
    ]);
    const moved = scan([at(0, stick), at(1000, stick, { axes: [0.8, 0, 0] })]);
    expect(moved.findings[0]!.detail).toBe(
      'Moved across 40% of its travel while untouched: was something touched, or is it drifting?'
    );
  });

  it('reports a hat that moves and a button released once as rogue input', () => {
    const report = scan([
      at(0, stick, { buttons: press(stick, 8) }),
      at(500, stick, { hats: [[0, 1]] }),
      at(600, stick),
    ]);
    expect(report.findings.map((f) => `${f.kind} ${f.input}: ${f.detail}`)).toEqual([
      'rogue Button 8: Released once with nobody touching it',
      'rogue Hat 1: Moved 2 times with nobody touching it',
    ]);
  });
});
