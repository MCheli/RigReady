import { circle, roundedRect } from './shapes';
import type { DeviceDrawingInput } from './silhouette';

/**
 * The parts a button panel is drawn with: keys, round buttons, toggle switches, knobs and
 * rockers, each as plain paths, and the words printed beside them. A panel's controls
 * use the glyph `none`: the part is already drawn, so nothing is put on top of it.
 */

export type PathItem = NonNullable<DeviceDrawingInput['paths']>[number];
export type TextItem = NonNullable<DeviceDrawingInput['texts']>[number];
export type DrawnControl = DeviceDrawingInput['controls'][number];
export type DrawnInput = NonNullable<DrawnControl['inputs']>[number];

/** A square or oblong key, centred on (x, y). */
export const keyAt = (x: number, y: number, w: number, h: number = w, r = 5): PathItem => ({
  d: roundedRect(x - w / 2, y - h / 2, w, h, r),
  role: 'key',
});

/** A round push button, centred on (x, y). */
export const roundAt = (x: number, y: number, r: number): PathItem => ({
  d: circle(x, y, r),
  role: 'key',
});

/** A toggle switch: its round collar and the end of its lever. */
export const toggleAt = (x: number, y: number): PathItem[] => [
  { d: circle(x, y, 12), role: 'key' },
  { d: circle(x, y, 5), role: 'screen' },
];

/** A knob with the line that shows where it points. */
export const knobAt = (x: number, y: number, r = 15): PathItem[] => [
  { d: circle(x, y, r), role: 'key' },
  { d: `M ${x} ${y - r + 3} L ${x} ${y - 3}`, role: 'line' },
];

/** A rocker that tips up and down, with the line between its halves. */
export const rockerAt = (x: number, y: number, w = 24, h = 48): PathItem[] => [
  keyAt(x, y, w, h, 6),
  { d: `M ${x - w / 2 + 4} ${y} L ${x + w / 2 - 4} ${y}`, role: 'line' },
];

/** A rocker that tips left and right. */
export const rockerAcrossAt = (x: number, y: number, w = 48, h = 24): PathItem[] => [
  keyAt(x, y, w, h, 6),
  { d: `M ${x} ${y - h / 2 + 4} L ${x} ${y + h / 2 - 4}`, role: 'line' },
];

/** Words printed on the panel, centred on x. */
export const label = (x: number, y: number, text: string, size = 8): TextItem => ({
  x,
  y,
  text,
  size,
});

/** One button of a control, with the word that tells it from the others. */
export const btn = (button: number, tag?: string): DrawnInput => ({
  id: `button:${button}`,
  ...(tag ? { tag } : {}),
});

/** One axis of a control. */
export const axis = (name: string, tag?: string): DrawnInput => ({
  id: `axis:${name}`,
  ...(tag ? { tag } : {}),
});

/** A control whose part is already drawn: a name, a place, a side and its inputs. */
export const part = (
  id: string,
  name: string,
  x: number,
  y: number,
  side: NonNullable<DrawnControl['side']>,
  inputs: DrawnInput[],
  more: Partial<DrawnControl> = {}
): DrawnControl => ({ id, name, glyph: 'none', at: { x, y }, side, inputs, ...more });
