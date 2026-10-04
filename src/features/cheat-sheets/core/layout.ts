import { z } from 'zod';
import type { BoundControl } from '../../../core/bindings';

/**
 * The RigReady device layout format: where the controls of one controller model sit on a
 * picture of it. One JSON file per device model, written by the layout editor, shipped
 * for well-known devices and shareable between people. Described in ../LAYOUT-FORMAT.md.
 *
 * Coordinates are in canvas units (the canvas is `canvas.width` x `canvas.height`, any
 * size; shipped layouts are 1000 wide). Nothing in a layout is runnable: it is shapes,
 * rectangles and text, and an optional background image as a data URL.
 */

export const LAYOUT_FORMAT = 'rigready-device-layout';
export const LAYOUT_VERSION = 1;
export const LAYOUT_EXTENSION = 'rrlayout.json';

/**
 * A control of the device, named the way DirectInput numbers it, whatever the game:
 * `button:12` (Button 12, the first is 1), `axis:X` (X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2),
 * `hat:1:U` (hat 1 pushed up; U, UR, R, DR, D, DL, L, UL).
 */
export const CONTROL_ID =
  /^(button:[1-9]\d{0,2}|axis:[A-Z][A-Z0-9]{0,7}|hat:[1-9]:(U|UR|R|DR|D|DL|L|UL))$/;
export const ControlIdSchema = z.string().regex(CONTROL_ID);

export const HAT_DIRECTIONS = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'] as const;
export type HatDirection = (typeof HAT_DIRECTIONS)[number];
/** The positions of a cross: the eight directions and the press in the middle. */
export const CROSS_POSITIONS = [...HAT_DIRECTIONS, 'C'] as const;
export type CrossPosition = (typeof CROSS_POSITIONS)[number];

const coordinate = z.number().finite().min(-10000).max(10000);
const size = z.number().finite().min(1).max(10000);
const text = z.string().max(80);

const BoxSchema = z.object({ x: coordinate, y: coordinate, w: size, h: size });

const PinSchema = z.object({ x: coordinate, y: coordinate });

/** One button or one axis: a label card, optionally tied to a spot on the picture. */
const SingleControlSchema = BoxSchema.extend({
  kind: z.enum(['button', 'axis']),
  input: ControlIdSchema,
  /** What is printed on the device next to it: "OSB 6", "Trigger", "BATT". */
  label: text.optional(),
  /** Where the control is on the picture; a line is drawn from there to the card. */
  pin: PinSchema.optional(),
});

/**
 * A hat or a four/five-way switch: one glyph with a label card per direction. The inputs
 * may be hat directions or plain buttons (many grips report their switches as buttons).
 */
const CrossControlSchema = BoxSchema.extend({
  kind: z.literal('cross'),
  inputs: z
    .partialRecord(z.enum(CROSS_POSITIONS), ControlIdSchema)
    .refine((inputs) => Object.keys(inputs).length > 0, 'A cross needs at least one input'),
  label: text.optional(),
  pin: PinSchema.optional(),
});

export const LayoutControlSchema = z.discriminatedUnion('kind', [
  SingleControlSchema,
  CrossControlSchema,
]);
export type LayoutControl = z.infer<typeof LayoutControlSchema>;
export type SingleControl = z.infer<typeof SingleControlSchema>;
export type CrossControl = z.infer<typeof CrossControlSchema>;

/** A labelled frame around controls that belong together. */
export const LayoutGroupSchema = BoxSchema.extend({ label: text });
export type LayoutGroup = z.infer<typeof LayoutGroupSchema>;

/**
 * A piece of the drawing of the device. `role` picks the colour from the theme, so one
 * layout prints on white paper and shows on a dark screen.
 */
const role = z.enum(['body', 'panel', 'screen', 'line', 'accent']).default('body');
export const LayoutShapeSchema = z.discriminatedUnion('type', [
  BoxSchema.extend({
    type: z.literal('rect'),
    r: z.number().min(0).max(5000).default(0),
    role,
  }),
  z.object({
    type: z.literal('ellipse'),
    cx: coordinate,
    cy: coordinate,
    rx: size,
    ry: size,
    role,
  }),
  z.object({
    type: z.literal('line'),
    /** x1 y1 x2 y2 ... : a line through these points. */
    points: z.array(coordinate).min(4).max(400),
    closed: z.boolean().default(false),
    role,
  }),
  z.object({
    type: z.literal('text'),
    x: coordinate,
    y: coordinate,
    text: z.string().max(60),
    size: z.number().min(4).max(200).default(14),
    role,
  }),
]);
export type LayoutShape = z.infer<typeof LayoutShapeSchema>;

const hex4 = z
  .string()
  .regex(/^[0-9A-Fa-f]{4}$/)
  .transform((v) => v.toUpperCase());

/** At most this much image data (as a data URL) in one layout file: about 6 MB of picture. */
export const MAX_BACKGROUND_CHARS = 8_000_000;

export const DeviceLayoutSchema = z.object({
  format: z.literal(LAYOUT_FORMAT),
  version: z.literal(LAYOUT_VERSION),
  /** "WinWing MFD1 button frame". */
  name: z.string().min(1).max(120),
  /** Which devices this layout is for: USB vendor id and one or more product ids. */
  match: z.object({
    vendorId: hex4,
    productIds: z.array(hex4).min(1).max(32),
  }),
  author: z.string().max(120).optional(),
  /** Layouts shared with others should say how they may be used; shipped ones are CC0-1.0. */
  license: z.string().max(60).optional(),
  /** Anything the user should know: "Button order on the grip is assumed". */
  notes: z.string().max(600).optional(),
  canvas: z.object({ width: size, height: size }),
  /** A photo or drawing behind the controls, as a PNG, JPEG, WebP or SVG data URL. */
  background: BoxSchema.extend({
    image: z
      .string()
      .max(MAX_BACKGROUND_CHARS)
      .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/),
    opacity: z.number().min(0.05).max(1).default(1),
  }).optional(),
  shapes: z.array(LayoutShapeSchema).max(400).default([]),
  groups: z.array(LayoutGroupSchema).max(200).default([]),
  controls: z.array(LayoutControlSchema).max(600),
});
export type DeviceLayout = z.infer<typeof DeviceLayoutSchema>;
export type DeviceLayoutInput = z.input<typeof DeviceLayoutSchema>;

/** Every control id a layout places. */
export function placedControls(layout: Pick<DeviceLayout, 'controls'>): Set<string> {
  const ids = new Set<string>();
  for (const control of layout.controls) {
    if (control.kind === 'cross') for (const id of Object.values(control.inputs)) ids.add(id);
    else ids.add(control.input);
  }
  return ids;
}

/** "4098:BEE1" */
export const modelKey = (vendorId: string, productId: string): string =>
  `${vendorId.toUpperCase()}:${productId.toUpperCase()}`;

export function layoutMatches(
  layout: Pick<DeviceLayout, 'match'>,
  vendorId: string | undefined,
  productId: string | undefined
): boolean {
  if (!vendorId || !productId) return false;
  return (
    layout.match.vendorId === vendorId.toUpperCase() &&
    layout.match.productIds.includes(productId.toUpperCase())
  );
}

/** Parses a layout file's text. The error says what is wrong in words a person can act on. */
export function parseLayout(
  textContent: string
): { ok: true; layout: DeviceLayout } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(textContent);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `It is not valid JSON (${detail}).` };
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { format?: unknown }).format !== LAYOUT_FORMAT
  ) {
    return {
      ok: false,
      reason: `It is not a RigReady device layout (no "format": "${LAYOUT_FORMAT}").`,
    };
  }
  const parsed = DeviceLayoutSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: z.prettifyError(parsed.error) };
  const seen = new Set<string>();
  for (const control of parsed.data.controls) {
    const ids = control.kind === 'cross' ? Object.values(control.inputs) : [control.input];
    for (const id of ids) {
      if (seen.has(id)) return { ok: false, reason: `The control ${id} is placed more than once.` };
      seen.add(id);
    }
  }
  return { ok: true, layout: parsed.data };
}

/** The text of a layout file: stable key order, readable, ends with a newline. */
export function serializeLayout(layout: DeviceLayout): string {
  return JSON.stringify(DeviceLayoutSchema.parse(layout), null, 2) + '\n';
}

/** "Button 12", "X axis", "Hat 1 up" for a control id. */
export function controlName(id: string): string {
  const [kind, a, b] = id.split(':');
  if (kind === 'button') return `Button ${a}`;
  if (kind === 'axis') return AXIS_NAMES[a ?? ''] ?? `${a} axis`;
  if (kind === 'hat') return `Hat ${a} ${HAT_WORDS[b as HatDirection] ?? b}`;
  return id;
}

/** "12", "X", "H1↑": what fits in the corner of a card. */
export function controlShort(id: string): string {
  const [kind, a, b] = id.split(':');
  if (kind === 'button') return a ?? '';
  if (kind === 'axis') return AXIS_SHORT[a ?? ''] ?? a ?? '';
  if (kind === 'hat') return `H${a}${HAT_ARROWS[b as HatDirection] ?? ''}`;
  return id;
}

const AXIS_NAMES: Record<string, string> = {
  X: 'X axis',
  Y: 'Y axis',
  Z: 'Z axis',
  RX: 'X rotation',
  RY: 'Y rotation',
  RZ: 'Z rotation',
  SLIDER1: 'Slider 1',
  SLIDER2: 'Slider 2',
};
const AXIS_SHORT: Record<string, string> = {
  X: 'X',
  Y: 'Y',
  Z: 'Z',
  RX: 'RX',
  RY: 'RY',
  RZ: 'RZ',
  SLIDER1: 'S1',
  SLIDER2: 'S2',
};
const HAT_WORDS: Record<HatDirection, string> = {
  U: 'up',
  UR: 'up-right',
  R: 'right',
  DR: 'down-right',
  D: 'down',
  DL: 'down-left',
  L: 'left',
  UL: 'up-left',
};
export const HAT_ARROWS: Record<CrossPosition, string> = {
  U: '↑',
  UR: '↗',
  R: '→',
  DR: '↘',
  D: '↓',
  DL: '↙',
  L: '←',
  UL: '↖',
  C: '●',
};

/**
 * A game's name for an input as a control id. DirectInput names (DCS: JOY_BTN12,
 * JOY_BTN_POV1_U, JOY_RZ, JOY_SLIDER1) are understood; anything else has no place on a
 * picture and is listed beside it.
 */
export function controlIdOf(gameInput: string): string | undefined {
  const button = /^JOY_BTN(\d{1,3})$/.exec(gameInput);
  if (button) return Number(button[1]) > 0 ? `button:${Number(button[1])}` : undefined;
  const hat = /^JOY_BTN_POV(\d)_(U|UR|R|DR|D|DL|L|UL)$/.exec(gameInput);
  if (hat) return `hat:${hat[1]}:${hat[2]}`;
  const axis = /^JOY_(X|Y|Z|RX|RY|RZ|SLIDER\d)$/.exec(gameInput);
  if (axis) return `axis:${axis[1]}`;
  return undefined;
}

/**
 * The control id of a binding. A reader that says which control it is (core's neutral
 * `control`: every racing game, and DCS) is taken at its word; otherwise the game's input
 * name is read as a DirectInput name.
 */
export function controlIdFor(binding: {
  input: string;
  control?: BoundControl | undefined;
}): string | undefined {
  const control = binding.control;
  if (!control) return controlIdOf(binding.input);
  const id =
    control.kind === 'button'
      ? `button:${control.index}`
      : control.kind === 'hat'
        ? `hat:${control.hat}:${control.direction}`
        : `axis:${control.axis}`;
  return CONTROL_ID.test(id) ? id : undefined;
}

/** Sort order of control ids: axes, hats, then buttons by number. */
export function compareControlIds(a: string, b: string): number {
  const rank = (id: string): [number, number, string] => {
    const [kind, x, y] = id.split(':');
    if (kind === 'axis') return [0, 0, x ?? ''];
    if (kind === 'hat') return [1, Number(x), y ?? ''];
    return [2, Number(x), ''];
  };
  const ra = rank(a);
  const rb = rank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
}
