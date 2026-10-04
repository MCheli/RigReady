import { z } from 'zod';
import { RotationSchema, type DisplayInfo, type Rotation } from '../../../shared/models';
import { monitorLabels, type MonitorNames } from './labels';
import type { LayoutAnalysis, LayoutTarget } from './plan';

/**
 * The picture of "what would change": every monitor as it is now and as it would be once
 * the layout is applied, with the same id in both, so a drawing can move each one from
 * where it is to where it goes. Built from the same analysis that drives the apply.
 */

export const PreviewMonitorSchema = z.object({
  /** The monitor as it is connected now; the layout's own id for one that is not connected. */
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  primary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  /** Desktop size in this state, after rotation. 0 while it is off. */
  width: z.number().int(),
  height: z.number().int(),
  rotation: RotationSchema,
  /** False for a monitor the layout wants that is not connected: it stays where it is, absent. */
  connected: z.boolean(),
});
export type PreviewMonitor = z.infer<typeof PreviewMonitorSchema>;

export interface PreviewMaps {
  before: PreviewMonitor[];
  after: PreviewMonitor[];
}

const sideways = (r: Rotation): boolean => r === 90 || r === 270;

/** A size to draw for a monitor that is off now and whose layout does not say how big it is. */
const UNKNOWN_SIZE = { width: 1920, height: 1080 };

/** The size a monitor has once it is turned to `rotation`, from what is known about it. */
function sizeAt(
  have: DisplayInfo,
  rotation: Rotation,
  wanted: { width?: number | undefined; height?: number | undefined }
): { width: number; height: number } {
  if (wanted.width !== undefined && wanted.height !== undefined) {
    return { width: wanted.width, height: wanted.height };
  }
  if (have.enabled && have.width > 0 && have.height > 0) {
    const turn = sideways(rotation) !== sideways(have.rotation);
    return turn
      ? { width: have.height, height: have.width }
      : { width: have.width, height: have.height };
  }
  // Off now: the largest mode it offers, when Windows lists any.
  const mode = [...(have.modes ?? [])].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const natural = mode ? { width: mode.width, height: mode.height } : UNKNOWN_SIZE;
  return sideways(rotation) ? { width: natural.height, height: natural.width } : natural;
}

/**
 * The monitors as they are and as they would be after applying `expected`. Monitors the
 * layout does not mention stay as they are (apply leaves them alone); monitors it wants on
 * that are not connected appear only in "after", marked as not connected.
 */
export function previewMaps(
  expected: LayoutTarget[],
  current: DisplayInfo[],
  analysis: Pick<LayoutAnalysis, 'targets' | 'labels' | 'missing' | 'offset'>,
  names: MonitorNames = {}
): PreviewMaps {
  const labels = monitorLabels(current, names);
  const labelOf = (d: DisplayInfo): string => labels.get(d.id.toLowerCase()) ?? d.name;
  const targets = new Map(analysis.targets.map((t) => [t.id.toLowerCase(), t]));
  const takesOver = analysis.targets.some((t) => t.enabled && t.primary);

  const before: PreviewMonitor[] = current.map((d) => ({
    id: d.id,
    label: labelOf(d),
    enabled: d.enabled,
    primary: d.enabled && d.primary,
    x: d.x,
    y: d.y,
    width: d.enabled ? d.width : 0,
    height: d.enabled ? d.height : 0,
    rotation: d.rotation,
    connected: true,
  }));

  const after: PreviewMonitor[] = current.map((d, i) => {
    const target = targets.get(d.id.toLowerCase());
    // Not part of the layout: left alone, though it may lose "main display" to another.
    if (!target) return { ...before[i]!, primary: before[i]!.primary && !takesOver };
    if (!target.enabled) {
      return { ...before[i]!, enabled: false, primary: false, x: 0, y: 0, width: 0, height: 0 };
    }
    const rotation = target.rotation;
    return {
      id: d.id,
      label: labelOf(d),
      enabled: true,
      primary: target.primary,
      x: target.x,
      y: target.y,
      ...sizeAt(d, rotation, target),
      rotation,
      connected: true,
    };
  });

  // What the layout wants on and is not connected: drawn where it would be, as absent.
  const missing = new Set(analysis.missing);
  for (const want of expected) {
    const label = analysis.labels.get(want.id.toLowerCase()) ?? want.name;
    if (!want.enabled || !missing.has(label)) continue;
    const natural = sideways(want.rotation)
      ? { width: UNKNOWN_SIZE.height, height: UNKNOWN_SIZE.width }
      : UNKNOWN_SIZE;
    after.push({
      id: want.id,
      label,
      enabled: true,
      primary: false,
      x: want.x - analysis.offset.x,
      y: want.y - analysis.offset.y,
      width: want.width ?? natural.width,
      height: want.height ?? natural.height,
      rotation: want.rotation,
      connected: false,
    });
  }
  return { before, after };
}

export interface MorphBox {
  id: string;
  label: string;
  /** Position and size in percent of the frame, for each state; undefined while it is not drawn. */
  before?: { left: number; top: number; width: number; height: number };
  after?: { left: number; top: number; width: number; height: number };
  primaryBefore: boolean;
  primaryAfter: boolean;
  rotationBefore: Rotation;
  rotationAfter: Rotation;
  /** Desktop size in each state, for the label. */
  sizeBefore: string;
  sizeAfter: string;
  connected: boolean;
  /** What happens to it, in words: "moves", "turns", "turns off". Empty when nothing does. */
  changes: string[];
}

export interface Morph {
  /** Height of the frame as a fraction of its width. */
  ratio: number;
  boxes: MorphBox[];
  /** Labels of the monitors that are off in each state. */
  offBefore: string[];
  offAfter: string[];
}

/**
 * One frame for both states (so nothing jumps when the picture changes) and, per monitor,
 * where it is drawn in each. A monitor that is off in a state is not drawn in it.
 */
export function morphOf(maps: PreviewMaps): Morph {
  const drawn = [...maps.before, ...maps.after].filter((m) => m.enabled && m.width > 0);
  if (drawn.length === 0) return { ratio: 0.3, boxes: [], offBefore: [], offAfter: [] };
  const minX = Math.min(...drawn.map((m) => m.x));
  const minY = Math.min(...drawn.map((m) => m.y));
  const width = Math.max(...drawn.map((m) => m.x + m.width)) - minX;
  const height = Math.max(...drawn.map((m) => m.y + m.height)) - minY;
  const place = (m: PreviewMonitor | undefined): MorphBox['before'] =>
    m && m.enabled && m.width > 0
      ? {
          left: ((m.x - minX) / width) * 100,
          top: ((m.y - minY) / height) * 100,
          width: (m.width / width) * 100,
          height: (m.height / height) * 100,
        }
      : undefined;
  const ids = [...new Set([...maps.before, ...maps.after].map((m) => m.id))];
  const boxes = ids.map((id): MorphBox => {
    const a = maps.before.find((m) => m.id === id);
    const b = maps.after.find((m) => m.id === id);
    const any = (b ?? a)!;
    const onBefore = a?.enabled ?? false;
    const onAfter = b?.enabled ?? false;
    const changes: string[] = [];
    if (b && !b.connected) changes.push('not connected');
    else if (onBefore && !onAfter) changes.push('turns off');
    else if (!onBefore && onAfter) changes.push('turns on');
    else if (a && b && onBefore && onAfter) {
      if (a.rotation !== b.rotation) changes.push('turns');
      else if (a.width !== b.width || a.height !== b.height) changes.push('changes size');
      if (a.x !== b.x || a.y !== b.y) changes.push('moves');
      if (!a.primary && b.primary) changes.push('becomes the main display');
    }
    const box: MorphBox = {
      id,
      label: any.label,
      primaryBefore: a?.primary ?? false,
      primaryAfter: b?.primary ?? false,
      rotationBefore: a?.rotation ?? 0,
      rotationAfter: b?.rotation ?? a?.rotation ?? 0,
      sizeBefore: onBefore && a ? `${a.width}x${a.height}` : '',
      sizeAfter: onAfter && b ? `${b.width}x${b.height}` : '',
      connected: any.connected,
      changes,
    };
    const before = place(a);
    const after = place(b);
    if (before) box.before = before;
    if (after) box.after = after;
    return box;
  });
  return {
    ratio: height / width,
    boxes,
    offBefore: maps.before.filter((m) => !m.enabled).map((m) => m.label),
    offAfter: maps.after.filter((m) => m.connected && !m.enabled).map((m) => m.label),
  };
}
