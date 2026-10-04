import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import {
  analyzeHealth,
  HealthReportSchema,
  healthText,
  looksLikePanel,
  MAX_TRACE_POINTS,
  problemCount,
  remark,
  thinTrace,
  type Sample,
} from './health';

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

describe('the evidence of a finding', () => {
  it('keeps the trace of a noisy axis: when it moved, how far, and where it rested', () => {
    const report = scan([
      at(0, stick),
      at(1000, stick, { axes: [0, 0, 0.02] }),
      // Another axis reports; this one says nothing new.
      at(1500, stick, { axes: [0.004, 0, 0.02] }),
      at(2000, stick, { axes: [0, 0, -0.03] }),
    ]);
    const noisy = report.findings.find((f) => f.input === 'Z axis')!;
    expect(noisy.evidence).toEqual({
      kind: 'axis',
      points: [
        [0, 50],
        [1, 51],
        [2, 48.5],
      ],
      low: 48.5,
      high: 51,
      rest: 50,
    });
    // 2.5% of travel on a bar that is full at 10%.
    expect(noisy.measure).toBe('2.5%');
    expect(noisy.measureOf).toBe('of its travel (1% is the limit)');
    expect(noisy.severity).toBe(25);
    expect(noisy.meaning).toContain('never quite rests');
    expect(noisy.advice).toContain('dead zone');
  });

  it('tells an axis that travelled a long way apart from one that trembles', () => {
    const moved = scan([at(0, stick), at(1000, stick, { axes: [0.8, 0, 0] })]).findings[0]!;
    expect(moved.severity).toBe(100);
    expect(moved.measure).toBe('40%');
    expect(moved.meaning).toContain('more than noise');
    expect(moved.advice).toContain('Check again');
  });

  it('keeps when a button was down: all of the check for a stuck one, each press of a rogue one', () => {
    const report = scan([
      at(0, stick, { buttons: press(stick, 2) }),
      at(8500, stick, { buttons: press(stick, 2, 6) }),
      at(8600, stick, { buttons: press(stick, 2) }),
      at(9000, stick, { buttons: press(stick, 2, 6) }),
      at(9250, stick, { buttons: press(stick, 2) }),
    ]);
    const [stuck, rogue] = report.findings;
    expect(stuck).toMatchObject({
      kind: 'stuck',
      input: 'Button 2',
      evidence: { kind: 'held', spans: [[0, 10]] },
      severity: 100,
      measure: '10 s',
      measureOf: 'held, of 10 s',
    });
    expect(stuck!.meaning).toContain('held down all the time');
    expect(rogue).toMatchObject({
      kind: 'rogue',
      input: 'Button 6',
      evidence: {
        kind: 'held',
        spans: [
          [8.5, 8.6],
          [9, 9.25],
        ],
      },
      severity: 20,
      measure: '2×',
      measureOf: 'by itself in 10 s',
    });
    expect(rogue!.meaning).toContain('fires by itself');
  });

  it('measures a button held for part of the check against the whole of it', () => {
    const held = scan([
      at(0, stick),
      at(2000, stick, { buttons: press(stick, 4) }),
      at(8000, stick),
    ]).findings[0]!;
    expect(held).toMatchObject({
      kind: 'stuck',
      severity: 60,
      measure: '6 s',
      evidence: { kind: 'held', spans: [[2, 8]] },
    });
  });

  it('keeps when a hat was off its centre, and says what a game makes of that', () => {
    const report = scan([
      at(0, stick),
      at(500, stick, { hats: [[0, 1]] }),
      at(600, stick),
      at(9900, stick, { hats: [[1, 0]] }),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'rogue',
        input: 'Hat 1',
        evidence: {
          kind: 'held',
          spans: [
            [0.5, 0.6],
            [9.9, 10],
          ],
        },
        severity: 30,
        measure: '3×',
      }),
    ]);
    expect(report.findings[0]!.meaning).toContain('hat move by itself');
  });

  it('says a held switch on a panel is normal, and how to stop hearing about it', () => {
    const held = scan([at(0, panel, { buttons: press(panel, 3) })]).findings[0]!;
    expect(held.kind).toBe('switch');
    expect(held.meaning).toContain('normal on a panel');
    expect(held.advice).toContain('mark it');
    const marked = remark(held, true);
    expect(marked).toMatchObject({
      kind: 'expected',
      meaning: 'You marked this switch as normally on.',
      advice: '',
    });
    // Taking it back makes it a held switch to look at again, with its evidence kept.
    expect(remark(marked, false)).toMatchObject({ kind: 'switch', evidence: held.evidence });
    expect(remark(marked, false).advice).toContain('mark it');
  });

  it('thins a long trace without losing its spikes', () => {
    const points: [number, number][] = Array.from({ length: 1000 }, (_, i) => [i / 100, 50]);
    points[333] = [3.33, 57];
    points[700] = [7, 41.5];
    const thin = thinTrace(points, 60);
    expect(thin.length).toBeLessThanOrEqual(60);
    expect(thin.map((p) => p[1])).toContain(57);
    expect(thin.map((p) => p[1])).toContain(41.5);
    // Still in the order it happened.
    expect(thin.map((p) => p[0])).toEqual([...thin.map((p) => p[0])].sort((a, b) => a - b));
    expect(thin[0]).toEqual([0, 50]);
    const short: [number, number][] = [
      [0, 50],
      [1, 51],
    ];
    expect(thinTrace(short)).toBe(short);
  });

  it('thins the trace of an axis that reported hundreds of times', () => {
    const samples = Array.from({ length: 900 }, (_, i) =>
      at(i * 11, stick, { axes: [0, 0, i % 2 ? 0.03 : -0.03 + i / 100_000] })
    );
    const noisy = scan(samples).findings.find((f) => f.input === 'Z axis')!;
    expect(noisy.evidence?.kind).toBe('axis');
    if (noisy.evidence?.kind !== 'axis') return;
    expect(noisy.evidence.points.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(noisy.evidence.points.length).toBeGreaterThan(100);
    expect(HealthReportSchema.safeParse(scan(samples)).success).toBe(true);
  });
});

describe('the findings as text', () => {
  const report = scan([
    at(0, stick, { buttons: press(stick, 2) }),
    at(0, panel, { buttons: press(panel, 3) }),
    at(1000, stick, { buttons: press(stick, 2), axes: [0, 0, 0.02] }),
    at(2000, stick, { buttons: press(stick, 2), axes: [0, 0, -0.03] }),
    at(8500, stick, { buttons: press(stick, 2, 6), axes: [0, 0, -0.03] }),
    at(8600, stick, { buttons: press(stick, 2), axes: [0, 0, -0.03] }),
  ]);

  it('says what was checked, each finding with what was recorded, what it means and what to do', () => {
    const text = healthText(report);
    expect(text.split('\n').slice(0, 3)).toEqual([
      'RigReady health check',
      '2 game controllers checked for 10 seconds with nobody touching anything.',
      '4 things need a look.',
    ]);
    expect(text).toContain(
      [
        'STUCK BUTTON',
        'Controller 1 · Button 2',
        '  Held down for the whole 10 s test.',
        '  On from 0 s to 10 s.',
        '  In a game: A game sees this button held down all the time',
      ].join('\n')
    );
    expect(text).toContain(
      [
        'NOISY AXIS',
        'Controller 1 · Z axis',
        '  Wandered over 2.5% of its travel while untouched (more than 1% is noisy).',
        '  It stayed between 48.5% and 51% of its travel; it began at 50%.',
      ].join('\n')
    );
    expect(text).toContain(
      'ROGUE INPUT\nController 1 · Button 6\n  Pressed once and released once'
    );
    expect(text).toContain('  On from 8.5 s to 8.6 s.');
    expect(text).toContain('HELD (A SWITCH?)\nWINWING F18 STARTUP PANEL · Button 3');
    expect(text).toMatch(/What to do: .+\n$/);
    expect(problemCount(report)).toBe(4);
  });

  it('lists a switch marked as normally on apart, and does not count it', () => {
    const marked = {
      ...report,
      findings: report.findings.map((f) => (f.kind === 'switch' ? remark(f, true) : f)),
    };
    expect(problemCount(marked)).toBe(3);
    const text = healthText(marked);
    expect(text).toContain('3 things need a look.');
    expect(text).toContain(
      'SWITCH MARKED AS NORMALLY ON\nWINWING F18 STARTUP PANEL · Button 3\n  Not reported as a problem.'
    );
  });

  it('says so when nothing moved, and does not end a question with a full stop', () => {
    const quiet = healthText(scan([at(0, stick)]));
    expect(quiet).toBe(
      'RigReady health check\n2 game controllers checked for 10 seconds with nobody touching anything.\nAll quiet: nothing moved.\n'
    );
    const one = analyzeHealth({
      devices: [stick],
      samples: [at(0, stick), at(1000, stick, { axes: [0.8, 0, 0] })],
      start: 0,
      end: 10_000,
    });
    const text = healthText(one);
    expect(text).toContain('1 game controller checked');
    expect(text).toContain('1 thing needs a look.');
    expect(text).toContain('or is it drifting?\n');
  });
});
