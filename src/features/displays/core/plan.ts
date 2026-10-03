import { z } from 'zod';
import {
  DisplayTargetSchema,
  type DisplayInfo,
  type DisplayTarget,
  type Rotation,
} from '../../../shared/models';
import { matchMonitors } from './identity';
import { monitorLabels, type MonitorNames } from './labels';

/** A monitor as a layout or a setup expects it. Refresh rate is only compared when given. */
export const LayoutTargetSchema = DisplayTargetSchema.extend({
  refreshHz: z.number().positive().optional(),
});
export type LayoutTarget = z.infer<typeof LayoutTargetSchema>;

export interface LayoutAnalysis {
  /** One line per way the monitors differ from the layout. Empty when they match. */
  differences: string[];
  /** The differences applying the layout would change (all but the missing monitors). */
  changes: string[];
  /** Monitors the layout wants on that are not connected, by label. */
  missing: string[];
  /** Set when the layout's main display is not connected: its label. Another one takes over. */
  primaryMissing?: string;
  /** The monitor that would be the main display. */
  primaryLabel?: string;
  /** Reasons the layout cannot be applied even without the missing monitors. */
  problems: string[];
  /**
   * What to hand to DisplayProvider.apply for the connected monitors: ids as they are
   * connected now, positions moved so the main display is at 0,0.
   */
  targets: DisplayTarget[];
  /** Monitors that would be on, of those that are connected. */
  enabledCount: number;
  /** Label per expected monitor id (lower case). */
  labels: Map<string, string>;
}

const sideways = (r: Rotation): boolean => r === 90 || r === 270;

interface Box {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Compares a layout with the monitors as they are and works out how to apply it. The
 * same analysis drives the Fly check, the "what would change" preview and the apply.
 */
export function analyzeLayout(
  expected: LayoutTarget[],
  current: DisplayInfo[],
  names: MonitorNames = {}
): LayoutAnalysis {
  const labels = monitorLabels(expected, names);
  const matches = matchMonitors(expected, current);
  const labelOf = (t: LayoutTarget): string => labels.get(t.id.toLowerCase()) ?? t.name;
  const missing: string[] = [];
  const problems: string[] = [];
  const differences: string[] = [];

  // Where each monitor that should be on goes, before moving the main display to 0,0.
  const placed = matches
    .filter((m) => m.expected.enabled && m.actual)
    .map((m) => {
      const want = m.expected;
      const have = m.actual!;
      let width = want.width;
      let height = want.height;
      if ((width === undefined || height === undefined) && have.enabled && have.width > 0) {
        const turn = sideways(want.rotation) !== sideways(have.rotation);
        width = turn ? have.height : have.width;
        height = turn ? have.width : have.height;
      }
      return { match: m, width, height };
    });

  const wantedPrimary = matches.find((m) => m.expected.enabled && m.expected.primary);
  const primaryMissing =
    wantedPrimary && !wantedPrimary.actual ? labelOf(wantedPrimary.expected) : undefined;
  const primary =
    placed.find((p) => p.match === wantedPrimary) ??
    placed.find((p) => p.match.expected.x === 0 && p.match.expected.y === 0) ??
    placed[0];
  const dx = primary?.match.expected.x ?? 0;
  const dy = primary?.match.expected.y ?? 0;

  const missingLines = new Set<string>();
  for (const m of matches) {
    const want = m.expected;
    const label = labelOf(want);
    const have = m.actual;
    if (!have) {
      if (!want.enabled) continue; // Not connected is as good as off.
      missing.push(label);
      const line =
        m.lookalikes > 0
          ? `${label} was not found where it was: ${m.lookalikes} identical ${m.lookalikes === 1 ? 'monitor is' : 'monitors are'} connected elsewhere, so RigReady cannot tell which one it is`
          : `${label} is not connected`;
      missingLines.add(line);
      differences.push(line);
      continue;
    }
    if (!want.enabled) {
      if (have.enabled) differences.push(`${label} is on, expected off`);
      continue;
    }
    if (!have.enabled) {
      differences.push(`${label} is off, expected on`);
      continue;
    }
    if (have.rotation !== want.rotation) {
      differences.push(`${label} is rotated ${have.rotation}°, expected ${want.rotation}°`);
    }
    if (
      want.width !== undefined &&
      want.height !== undefined &&
      (have.width !== want.width || have.height !== want.height)
    ) {
      differences.push(
        `${label} is ${have.width}x${have.height}, expected ${want.width}x${want.height}`
      );
    }
    const x = want.x - dx;
    const y = want.y - dy;
    if (have.x !== x || have.y !== y) {
      differences.push(`${label} is at ${have.x},${have.y}, expected ${x},${y}`);
    }
    const isPrimary = primary?.match === m;
    if (isPrimary && !have.primary) differences.push(`${label} is not the main display`);
    if (
      want.refreshHz !== undefined &&
      have.refreshHz !== undefined &&
      Math.abs(have.refreshHz - want.refreshHz) >= 0.5
    ) {
      differences.push(`${label} runs at ${have.refreshHz} Hz, expected ${want.refreshHz} Hz`);
    }
  }

  // Monitors must not cover each other.
  const boxes: Box[] = placed
    .filter((p) => p.width !== undefined && p.height !== undefined)
    .map((p) => ({
      label: labelOf(p.match.expected),
      x: p.match.expected.x - dx,
      y: p.match.expected.y - dy,
      width: p.width!,
      height: p.height!,
    }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i]!, boxes[j]!)) {
        problems.push(`${boxes[i]!.label} and ${boxes[j]!.label} overlap.`);
      }
    }
  }

  const targets: DisplayTarget[] = matches
    .filter((m) => m.actual)
    .map((m) => {
      const want = m.expected;
      const id = m.actual!.id;
      if (!want.enabled) {
        return { id, name: want.name, enabled: false, primary: false, x: 0, y: 0, rotation: 0 };
      }
      const target: DisplayTarget = {
        id,
        name: want.name,
        enabled: true,
        primary: primary?.match === m,
        x: want.x - dx,
        y: want.y - dy,
        rotation: want.rotation,
      };
      if (want.width !== undefined && want.height !== undefined) {
        target.width = want.width;
        target.height = want.height;
      }
      return target;
    });

  const targeted = new Set(targets.map((t) => t.id));
  const staysOn =
    placed.length > 0 || current.some((d) => d.enabled && !targeted.has(d.id.toLowerCase()));
  if (!staysOn) problems.push('The layout would turn every monitor off.');

  const analysis: LayoutAnalysis = {
    differences,
    changes: differences.filter((line) => !missingLines.has(line)),
    missing,
    problems,
    targets,
    enabledCount: placed.length,
    labels,
  };
  if (primaryMissing) analysis.primaryMissing = primaryMissing;
  if (primary) analysis.primaryLabel = labelOf(primary.match.expected);
  return analysis;
}

/** "MFD left", "MFD left and TV", "MFD left, MFD right and TV". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
