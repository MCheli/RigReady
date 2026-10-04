import { z } from 'zod';
import type { InputDevice, InputState } from '../../../shared/models';
import { axisLabel, axisPercent, buttonLabel, hatDirection, hatLabel, inputKeyFor } from './input';

/**
 * The "hands off" health scan: while nobody touches anything, every controller should be
 * still. A button held the whole time is stuck (or a switch that is on), an axis that wanders
 * is noisy, and anything that fires on its own is a rogue input. Every finding carries what
 * was recorded, how bad it is, what a game makes of it and what to do about it.
 */

export const HELD_MS = 5000;
/** An axis whose values spread over more than 1% of its travel while untouched is noisy. */
export const NOISE_PERCENT = 1;
/** Noise this wide (percent of travel) fills the "how bad" bar. */
export const NOISE_FULL_PERCENT = 10;
/** An axis that covers this much of its travel untouched did more than tremble. */
export const DRIFT_PERCENT = 25;
/** This many presses, releases or hat moves by themselves fill the "how bad" bar. */
export const ROGUE_FULL_COUNT = 10;
/** The most points a recorded axis trace keeps (it is thinned beyond that). */
export const MAX_TRACE_POINTS = 240;
const MAX_SPANS = 200;

/** What was recorded of one input during the hands-off window. Times are seconds into it. */
export const EvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('axis'),
    /** Time and percent of travel, in order; the value holds until the next point. */
    points: z.array(z.tuple([z.number(), z.number()])).max(MAX_TRACE_POINTS),
    /** The lowest and highest percent seen. */
    low: z.number(),
    high: z.number(),
    /** Where it was when the window began. */
    rest: z.number(),
  }),
  z.object({
    kind: z.literal('held'),
    /** From when to when a button was down, or a hat off its centre. */
    spans: z.array(z.tuple([z.number(), z.number()])).max(MAX_SPANS),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  kind: z.enum(['stuck', 'switch', 'expected', 'noisy', 'rogue']),
  deviceIndex: z.number().int(),
  device: z.string().max(200),
  inputKey: z.string().max(200),
  /** "Button 3", "Z axis", "Hat 1". */
  input: z.string().max(80),
  /** Zero-based button index, for stuck and switch findings. */
  button: z.number().int().optional(),
  detail: z.string().max(400),
  /** Spread of a noisy axis in percent of its travel. */
  spread: z.number().optional(),
  /** How bad it is, 0 to 100: the length of the bar. */
  severity: z.number().min(0).max(100).default(0),
  /** The number the bar stands for, and what it counts: "2.5%" "of its travel". */
  measure: z.string().max(40).default(''),
  measureOf: z.string().max(80).default(''),
  /** What a game makes of it, and what to do about it: one plain sentence or two each. */
  meaning: z.string().max(400).default(''),
  advice: z.string().max(400).default(''),
  evidence: EvidenceSchema.optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const HealthReportSchema = z.object({
  seconds: z.number(),
  devicesChecked: z.number().int(),
  findings: z.array(FindingSchema).max(2000),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

export interface Sample {
  /** Milliseconds. */
  t: number;
  state: InputState;
}

/**
 * Button boxes and switch panels (many buttons, at most two axes, no hat) legitimately
 * hold buttons down: a toggle switch that is on reads as a held button.
 */
export function looksLikePanel(device: InputDevice): boolean {
  return device.numHats === 0 && device.numAxes <= 2 && device.numButtons >= 16;
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`;
const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const times = (n: number): string => (n === 1 ? 'once' : `${n} times`);

/**
 * At most `max` points of a trace, keeping its shape: the lowest and the highest point of
 * every stretch of time survive, so a spike is never thinned away.
 */
export function thinTrace(points: [number, number][], max = MAX_TRACE_POINTS): [number, number][] {
  if (points.length <= max) return points;
  const buckets = Math.max(1, Math.floor(max / 2));
  const first = points[0]![0];
  const span = Math.max(1e-9, points[points.length - 1]![0] - first);
  const out: [number, number][] = [];
  let at = 0;
  for (let b = 0; b < buckets && at < points.length; b++) {
    const end = b === buckets - 1 ? Infinity : first + ((b + 1) / buckets) * span;
    let low: [number, number] | undefined;
    let high: [number, number] | undefined;
    while (at < points.length && points[at]![0] <= end) {
      const point = points[at]!;
      if (!low || point[1] < low[1]) low = point;
      if (!high || point[1] > high[1]) high = point;
      at++;
    }
    if (!low || !high) continue;
    if (low === high) out.push(low);
    else out.push(...(low[0] <= high[0] ? [low, high] : [high, low]));
  }
  return out;
}

/** What a game makes of each kind of finding, and what to do about it. */
function explain(
  kind: Finding['kind'],
  what: 'button' | 'hat' | 'axis',
  spread = 0
): Pick<Finding, 'meaning' | 'advice'> {
  switch (kind) {
    case 'stuck':
      return {
        meaning:
          'A game sees this button held down all the time: what it is bound to keeps firing, and as a modifier it changes what other buttons do.',
        advice:
          'Press it a few times and check that nothing rests on it. If it stays down, clear its binding until the switch is repaired.',
      };
    case 'switch':
      return {
        meaning: 'A toggle switch that is on reads as a held button, which is normal on a panel.',
        advice:
          'If this switch is meant to be on, mark it and it is not reported again. If it is a push button, it is stuck.',
      };
    case 'expected':
      return { meaning: 'You marked this switch as normally on.', advice: '' };
    case 'noisy':
      return spread >= DRIFT_PERCENT
        ? {
            meaning:
              'This is more than noise: the axis travelled a long way with nobody touching it. In a game it moves its control by itself.',
            advice:
              'Check again with your hands off everything. If it moves again, the sensor or its cable needs attention.',
          }
        : {
            meaning:
              'A game sees this axis tremble, so what it is bound to never quite rests: a view that creeps, a trim that hunts.',
            advice:
              'Give the axis a small dead zone in the game, a little larger than the noise. If the noise grows, the sensor is worn or dirty.',
          };
    case 'rogue':
      return {
        meaning:
          what === 'hat'
            ? 'A game sees this hat move by itself: the view or the trim it is bound to jumps.'
            : 'A game sees this button pressed with nobody near it: its action fires by itself.',
        advice:
          'Usually a worn switch or a loose connector. Reseat the cable; if it keeps firing, clear its binding so it cannot set anything off in a game.',
      };
  }
}

export interface AnalyzeOptions {
  devices: InputDevice[];
  samples: Sample[];
  start: number;
  end: number;
  /** Switches the user marked as normally on: `${inputKey}/${button}`. */
  expected?: Set<string>;
  /** Display names by device index (the names the user gave). */
  names?: Map<number, string>;
}

export function analyzeHealth(options: AnalyzeOptions): HealthReport {
  const { devices, start, end } = options;
  const window = Math.max(0, end - start);
  const heldThreshold = Math.min(HELD_MS, window);
  const findings: Finding[] = [];
  const byIndex = new Map<number, Sample[]>();
  for (const sample of [...options.samples].sort((a, b) => a.t - b.t)) {
    const list = byIndex.get(sample.state.index) ?? [];
    list.push(sample);
    byIndex.set(sample.state.index, list);
  }
  /** Seconds into the window, never outside it. */
  const into = (t: number): number => round(Math.max(0, Math.min(window, t - start)) / 1000, 3);
  const windowText = seconds(window);

  for (const device of devices) {
    const samples = byIndex.get(device.index);
    if (!samples || samples.length === 0) continue;
    const key = inputKeyFor(device, devices);
    const name = options.names?.get(device.index) ?? device.name.trim();
    const base = { deviceIndex: device.index, device: name, inputKey: key };
    const first = samples[0]!;

    // Buttons: longest continuous hold, and presses or releases during the window.
    const buttons = Math.max(...samples.map((s) => s.state.buttons.length));
    for (let b = 0; b < buttons; b++) {
      let since: number | undefined;
      let longest = 0;
      let presses = 0;
      let releases = 0;
      let previous: boolean | undefined;
      const spans: [number, number][] = [];
      for (const sample of samples) {
        const pressed = sample.state.buttons[b] ?? false;
        const t = Math.max(start, sample.t);
        if (pressed && since === undefined) since = t;
        if (!pressed && since !== undefined) {
          longest = Math.max(longest, t - since);
          if (spans.length < MAX_SPANS) spans.push([into(since), into(t)]);
          since = undefined;
        }
        if (previous !== undefined && pressed !== previous) {
          if (pressed) presses++;
          else releases++;
        }
        previous = pressed;
      }
      if (since !== undefined) {
        longest = Math.max(longest, end - since);
        if (spans.length < MAX_SPANS) spans.push([into(since), into(end)]);
      }
      const evidence: Evidence = { kind: 'held', spans };
      const heldWhole = (first.state.buttons[b] ?? false) && presses === 0 && releases === 0;
      if (longest >= heldThreshold && heldThreshold > 0) {
        const marked = options.expected?.has(`${key}/${b}`) ?? false;
        const kind = marked ? 'expected' : looksLikePanel(device) ? 'switch' : 'stuck';
        findings.push({
          ...base,
          kind,
          input: buttonLabel(b),
          button: b,
          detail: heldWhole
            ? `Held down for the whole ${windowText} test`
            : `Held down for ${seconds(longest)}`,
          severity: round(Math.min(100, (longest / window) * 100), 1),
          measure: seconds(longest),
          measureOf: `held, of ${windowText}`,
          ...explain(kind, 'button'),
          evidence,
        });
        // One long press is told once, as held.
        if (heldWhole || presses <= 1) continue;
      }
      if (presses + releases > 0) {
        const parts = [
          presses ? `pressed ${times(presses)}` : '',
          releases ? `released ${times(releases)}` : '',
        ].filter(Boolean);
        const count = Math.max(presses, releases);
        findings.push({
          ...base,
          kind: 'rogue',
          input: buttonLabel(b),
          detail: `${parts.join(' and ')} with nobody touching it`.replace(/^./, (c) =>
            c.toUpperCase()
          ),
          severity: round(Math.min(100, (count / ROGUE_FULL_COUNT) * 100), 1),
          measure: `${count}×`,
          measureOf: `by itself in ${windowText}`,
          ...explain('rogue', 'button'),
          evidence,
        });
      }
    }

    // Hats: any movement is rogue input.
    const hats = Math.max(...samples.map((s) => s.state.hats.length));
    for (let h = 0; h < hats; h++) {
      const directions = samples.map((s) => hatDirection(s.state.hats[h]));
      const moves = directions.filter((d, i) => i > 0 && d !== directions[i - 1]).length;
      if (moves > 0) {
        const spans: [number, number][] = [];
        let since: number | undefined;
        for (let i = 0; i < samples.length; i++) {
          const off = directions[i] !== 'centred';
          if (off && since === undefined) since = samples[i]!.t;
          if (!off && since !== undefined) {
            if (spans.length < MAX_SPANS) spans.push([into(since), into(samples[i]!.t)]);
            since = undefined;
          }
        }
        if (since !== undefined && spans.length < MAX_SPANS) spans.push([into(since), into(end)]);
        findings.push({
          ...base,
          kind: 'rogue',
          input: hatLabel(h),
          detail: `Moved ${times(moves)} with nobody touching it`,
          severity: round(Math.min(100, (moves / ROGUE_FULL_COUNT) * 100), 1),
          measure: `${moves}×`,
          measureOf: `by itself in ${windowText}`,
          ...explain('rogue', 'hat'),
          evidence: { kind: 'held', spans },
        });
      }
    }

    // Axes: spread of the values seen.
    const axes = Math.max(...samples.map((s) => s.state.axes.length));
    for (let a = 0; a < axes; a++) {
      const seen = samples
        .map((s) => [s.t, s.state.axes[a]] as const)
        .filter((entry): entry is readonly [number, number] => entry[1] !== undefined);
      if (seen.length < 2) continue;
      const values = seen.map(([, v]) => v);
      const low = Math.min(...values);
      const high = Math.max(...values);
      const spread = ((high - low) / 2) * 100;
      if (spread > NOISE_PERCENT) {
        const rounded = Math.round(spread * 10) / 10;
        // Only the samples at which this axis changed: the others say nothing new about it.
        const points: [number, number][] = [];
        for (const [t, v] of seen) {
          const percent = round(axisPercent(v), 2);
          if (points.length === 0 || points[points.length - 1]![1] !== percent) {
            points.push([into(t), percent]);
          }
        }
        findings.push({
          ...base,
          kind: 'noisy',
          input: axisLabel(device, a),
          spread: rounded,
          detail:
            spread >= DRIFT_PERCENT
              ? `Moved across ${rounded}% of its travel while untouched: was something touched, or is it drifting?`
              : `Wandered over ${rounded}% of its travel while untouched (more than ${NOISE_PERCENT}% is noisy)`,
          severity: round(Math.min(100, (spread / NOISE_FULL_PERCENT) * 100), 1),
          measure: `${rounded}%`,
          measureOf: `of its travel (${NOISE_PERCENT}% is the limit)`,
          ...explain('noisy', 'axis', spread),
          evidence: {
            kind: 'axis',
            points: thinTrace(points),
            low: round(axisPercent(low), 2),
            high: round(axisPercent(high), 2),
            rest: round(axisPercent(values[0]!), 2),
          },
        });
      }
    }
  }
  const order = { stuck: 0, rogue: 1, noisy: 2, switch: 3, expected: 4 } as const;
  findings.sort((a, b) => order[a.kind] - order[b.kind] || a.device.localeCompare(b.device));
  return { seconds: Math.round(window / 100) / 10, devicesChecked: devices.length, findings };
}

/**
 * What a held button becomes once the user says it is a switch that is meant to be on, and
 * what it goes back to when they take that back: a held switch to look at.
 */
export function remark(finding: Finding, expected: boolean): Finding {
  const kind = expected ? 'expected' : 'switch';
  return { ...finding, kind, ...explain(kind, 'button') };
}

const HEADINGS: Record<Finding['kind'], string> = {
  stuck: 'STUCK BUTTON',
  rogue: 'ROGUE INPUT',
  noisy: 'NOISY AXIS',
  switch: 'HELD (A SWITCH?)',
  expected: 'SWITCH MARKED AS NORMALLY ON',
};

/** How many findings are problems: everything but the switches marked as normally on. */
export const problemCount = (report: HealthReport): number =>
  report.findings.filter((f) => f.kind !== 'expected').length;

/** The report as plain text, to paste into a forum post or a support request. */
export function healthText(report: HealthReport): string {
  const problems = problemCount(report);
  const controllers = `${report.devicesChecked} game ${report.devicesChecked === 1 ? 'controller' : 'controllers'}`;
  const lines = [
    'RigReady health check',
    `${controllers} checked for ${report.seconds} seconds with nobody touching anything.`,
    problems === 0
      ? 'All quiet: nothing moved.'
      : `${problems} ${problems === 1 ? 'thing needs' : 'things need'} a look.`,
  ];
  for (const f of report.findings) {
    lines.push('', HEADINGS[f.kind], `${f.device} · ${f.input}`);
    if (f.kind === 'expected') {
      lines.push('  Not reported as a problem.');
      continue;
    }
    lines.push(`  ${f.detail}${/[.?!]$/.test(f.detail) ? '' : '.'}`);
    if (f.evidence?.kind === 'axis') {
      lines.push(
        `  It stayed between ${f.evidence.low}% and ${f.evidence.high}% of its travel; it began at ${f.evidence.rest}%.`
      );
    } else if (f.evidence && f.evidence.spans.length > 0 && f.evidence.spans.length <= 12) {
      lines.push(
        `  On from ${f.evidence.spans.map(([from, to]) => `${from} s to ${to} s`).join(', ')}.`
      );
    }
    if (f.meaning) lines.push(`  In a game: ${f.meaning}`);
    if (f.advice) lines.push(`  What to do: ${f.advice}`);
  }
  return `${lines.join('\n')}\n`;
}
