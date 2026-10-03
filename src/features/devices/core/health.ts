import { z } from 'zod';
import type { InputDevice, InputState } from '../../../shared/models';
import { axisLabel, buttonLabel, hatDirection, hatLabel, inputKeyFor } from './input';

/**
 * The "hands off" health scan: while nobody touches anything, every controller should be
 * still. A button held the whole time is stuck (or a switch that is on), an axis that wanders
 * is noisy, and anything that fires on its own is a rogue input.
 */

export const HELD_MS = 5000;
/** An axis whose values spread over more than 1% of its travel while untouched is noisy. */
export const NOISE_PERCENT = 1;

export const FindingSchema = z.object({
  kind: z.enum(['stuck', 'switch', 'expected', 'noisy', 'rogue']),
  deviceIndex: z.number().int(),
  device: z.string(),
  inputKey: z.string(),
  /** "Button 3", "Z axis", "Hat 1". */
  input: z.string(),
  /** Zero-based button index, for stuck and switch findings. */
  button: z.number().int().optional(),
  detail: z.string(),
  /** Spread of a noisy axis in percent of its travel. */
  spread: z.number().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const HealthReportSchema = z.object({
  seconds: z.number(),
  devicesChecked: z.number().int(),
  findings: z.array(FindingSchema),
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
      for (const sample of samples) {
        const pressed = sample.state.buttons[b] ?? false;
        const t = Math.max(start, sample.t);
        if (pressed && since === undefined) since = t;
        if (!pressed && since !== undefined) {
          longest = Math.max(longest, t - since);
          since = undefined;
        }
        if (previous !== undefined && pressed !== previous) {
          if (pressed) presses++;
          else releases++;
        }
        previous = pressed;
      }
      if (since !== undefined) longest = Math.max(longest, end - since);
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
            ? `Held down for the whole ${seconds(window)} test`
            : `Held down for ${seconds(longest)}`,
        });
        // One long press is told once, as held.
        if (heldWhole || presses <= 1) continue;
      }
      if (presses + releases > 0) {
        const parts = [
          presses ? `pressed ${presses === 1 ? 'once' : `${presses} times`}` : '',
          releases ? `released ${releases === 1 ? 'once' : `${releases} times`}` : '',
        ].filter(Boolean);
        findings.push({
          ...base,
          kind: 'rogue',
          input: buttonLabel(b),
          detail: `${parts.join(' and ')} with nobody touching it`.replace(/^./, (c) =>
            c.toUpperCase()
          ),
        });
      }
    }

    // Hats: any movement is rogue input.
    const hats = Math.max(...samples.map((s) => s.state.hats.length));
    for (let h = 0; h < hats; h++) {
      const directions = samples.map((s) => hatDirection(s.state.hats[h]));
      const moves = directions.filter((d, i) => i > 0 && d !== directions[i - 1]).length;
      if (moves > 0) {
        findings.push({
          ...base,
          kind: 'rogue',
          input: hatLabel(h),
          detail: `Moved ${moves === 1 ? 'once' : `${moves} times`} with nobody touching it`,
        });
      }
    }

    // Axes: spread of the values seen.
    const axes = Math.max(...samples.map((s) => s.state.axes.length));
    for (let a = 0; a < axes; a++) {
      const values = samples
        .map((s) => s.state.axes[a])
        .filter((v): v is number => v !== undefined);
      if (values.length < 2) continue;
      const spread = ((Math.max(...values) - Math.min(...values)) / 2) * 100;
      if (spread > NOISE_PERCENT) {
        const rounded = Math.round(spread * 10) / 10;
        findings.push({
          ...base,
          kind: 'noisy',
          input: axisLabel(device, a),
          spread: rounded,
          detail:
            spread >= 25
              ? `Moved across ${rounded}% of its travel while untouched: was something touched, or is it drifting?`
              : `Wandered over ${rounded}% of its travel while untouched (more than ${NOISE_PERCENT}% is noisy)`,
        });
      }
    }
  }
  const order = { stuck: 0, rogue: 1, noisy: 2, switch: 3, expected: 4 } as const;
  findings.sort((a, b) => order[a.kind] - order[b.kind] || a.device.localeCompare(b.device));
  return { seconds: Math.round(window / 100) / 10, devicesChecked: devices.length, findings };
}
