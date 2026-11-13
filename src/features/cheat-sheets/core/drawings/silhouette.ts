import { z } from 'zod';
import { ControlIdSchema } from '../controlId';

/**
 * The way a device with a drawing is drawn on its cheat sheet.
 *
 * A *drawing* is a hand-tuned silhouette of one controller model (SVG path data) with
 * the device's physical controls marked on it: where each one is, what it is (a hat, a
 * trigger, a key on a bezel) and which DirectInput inputs it reports. Labels are not part
 * of a drawing; `callouts.ts` places them around it automatically, one label block per
 * physical control, with a leader line to it.
 *
 * It is a data format on purpose (zod schema, nothing runnable), so a user or the
 * community can add a drawing for a device RigReady does not ship one for: an SVG traced
 * from a photo, with the anchors as a JSON list. See docs/research/controller-drawings.md.
 */

export const DRAWING_FORMAT = 'rigready-device-drawing';
export const DRAWING_VERSION = 1;

/** Which side of the drawing the label of a control goes on. */
export const SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type Side = (typeof SIDES)[number];

/**
 * What a control looks like, so the right marker is drawn at its anchor: a round hat with
 * four nubs, a square four-way switch, a plain button, a thumb-stick, a lever or trigger,
 * a two-way rocker, a rotary knob, a key on a bezel, an axis arrow (sideways, lengthways,
 * or both ways for a stick's two axes), or nothing (the silhouette itself already shows it).
 */
export const GLYPHS = [
  'hat',
  'switch',
  'button',
  'stick',
  'lever',
  'rocker',
  'knob',
  'key',
  'axis',
  'slide',
  'axes',
  'none',
] as const;
export type Glyph = (typeof GLYPHS)[number];

const coordinate = z.number().finite().min(-10000).max(10000);

/**
 * The colour role of a piece of the drawing, so one drawing works on a dark screen, on
 * white paper and on a night kneeboard page. `body` is the main surface, `panel` a raised
 * or recessed face, `screen` glass or a dark recess, `line` an outline, `accent` a
 * highlight, `shade` a shadow, `key` a raised key.
 */
export const DrawingRoleSchema = z.enum([
  'body',
  'panel',
  'screen',
  'line',
  'accent',
  'shade',
  'key',
]);
export type DrawingRole = z.infer<typeof DrawingRoleSchema>;

/** One SVG path of the silhouette: absolute commands only (M L H V C Q A Z), in drawing units. */
export const DrawingPathSchema = z.object({
  d: z.string().min(1).max(4000),
  role: DrawingRoleSchema.default('body'),
  /** Drawn dashed: a face the view does not show (the front of a grip). */
  dashed: z.boolean().default(false),
});
export type DrawingPath = z.infer<typeof DrawingPathSchema>;

/** Text printed on the device ("L", "R", "OSB"), part of the drawing. */
export const DrawingTextSchema = z.object({
  x: coordinate,
  y: coordinate,
  text: z.string().max(40),
  size: z.number().min(4).max(200).default(14),
});

/** One input of a physical control, with the word the label uses for it ("↑", "IDLE", "2nd"). */
export const ControlInputSchema = z.object({
  id: ControlIdSchema,
  tag: z.string().max(12).optional(),
  /**
   * The position the control rests in when nobody is using it: the middle of a three-way
   * switch, a lever let go, a throttle at its IDLE stop, a handle in the place it normally
   * sits (the wing fold handle at SPREAD). The device reports this input as held while the
   * control is there, so it reads as held before anything is pressed. A switch or knob with
   * no one normal place (a gear lever, a selector) has none of its positions marked.
   */
  rest: z.boolean().optional(),
});
export type ControlInput = z.infer<typeof ControlInputSchema>;

/**
 * A physical control of the device: one thing the hand finds. A hat is one control with
 * four or five inputs; a two-detent trigger is one control with two; a key is one with one.
 */
export const PhysicalControlSchema = z.object({
  /** Stable within the drawing: "trim-hat", "osb-6". */
  id: z.string().min(1).max(40),
  /** What the label calls it: "TRIM hat", "Trigger", "OSB 6". */
  name: z.string().min(1).max(60),
  glyph: z.enum(GLYPHS).default('button'),
  /** Where it is on the drawing, in drawing units. The leader line ends here. */
  at: z.object({ x: coordinate, y: coordinate }),
  /** Where its label goes. Left of centre goes left, right goes right, when not said. */
  side: z.enum(SIDES).optional(),
  /** The inputs it reports, in the order their rows are shown. May be empty: drawn, never labelled. */
  inputs: z.array(ControlInputSchema).max(16).default([]),
  /** On a face this view does not show (the front of a grip): the marker is drawn dashed. */
  hidden: z.boolean().default(false),
  /** The input numbers are a guess until someone checks them on the device. */
  assumed: z.boolean().default(false),
});
export type PhysicalControl = z.infer<typeof PhysicalControlSchema>;

const hex4 = z
  .string()
  .regex(/^[0-9A-Fa-f]{4}$/)
  .transform((v) => v.toUpperCase());

/** At most this much picture (as a data URL) in one drawing: about 6 MB. */
export const MAX_IMAGE_CHARS = 8_000_000;

/**
 * All the pictures of one layout together (the picture behind it, its drawing's picture and
 * photos) as data URL text: about 5 MB of picture. The window keeps a layout within it, so
 * its file stays under what an import of a layout file takes and can be shared again.
 */
export const MAX_PICTURE_CHARS = 7_000_000;

/** "5.6 MB": the size of the pictures held in this much data URL text. */
export const pictureSize = (chars: number): string =>
  `${Math.round((chars * 3) / 4 / 100_000) / 10} MB`;

/** The picture text a drawing holds: its picture and its photos. */
export function drawingPictureChars(drawing: {
  image?: string | undefined;
  views?: { image: string }[] | undefined;
}): number {
  return (
    (drawing.image?.length ?? 0) + (drawing.views ?? []).reduce((n, v) => n + v.image.length, 0)
  );
}

/** Why the pictures of a layout or drawing are refused, in words a person can act on. */
export const tooMuchPicture = (chars: number): string =>
  `The pictures in it are too large together (${pictureSize(chars)}). A layout holds about 5 MB of pictures at most. Use smaller photos, or fewer.`;

/** A picture as a data URL: PNG, JPEG, WebP or SVG. Shown as an image, never run. */
export const ImageDataSchema = z
  .string()
  .max(MAX_IMAGE_CHARS)
  .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/);

/** At most this many photos in one drawing. */
export const MAX_VIEWS = 6;

/**
 * One photo of the device with a name of its own ("Front", "Back", "Top"): a view. A
 * device seen from several sides has several, each in its own box of the drawing; a
 * control is on the view its anchor lies in.
 */
export const DrawingViewSchema = z.object({
  name: z.string().min(1).max(40),
  image: ImageDataSchema,
  x: coordinate,
  y: coordinate,
  w: z.number().min(1).max(10000),
  h: z.number().min(1).max(10000),
});
export type DrawingView = z.infer<typeof DrawingViewSchema>;

export const DrawingMatchSchema = z
  .object({
    vendorId: hex4,
    productIds: z.array(hex4).max(32).default([]),
    /**
     * Parts of the name the hardware reports ("F18 GRIP"), any case, for a device whose
     * product id is not known or is shared by several models.
     */
    names: z.array(z.string().min(3).max(60)).max(8).default([]),
  })
  .refine((m) => m.productIds.length > 0 || m.names.length > 0, {
    message: 'A drawing says which devices it is for: a product id or a part of the name.',
  });

export const DeviceDrawingSchema = z
  .object({
    format: z.literal(DRAWING_FORMAT),
    version: z.literal(DRAWING_VERSION),
    /** "WinWing Orion 2 stick with F-16EX grip". */
    name: z.string().min(1).max(120),
    match: DrawingMatchSchema,
    author: z.string().max(120).optional(),
    license: z.string().max(60).optional(),
    /** Which way the device is seen: "from behind, as the pilot sees it". */
    view: z.string().max(120).optional(),
    notes: z.string().max(600).optional(),
    /** The drawing's own size; everything else is in these units. */
    size: z.object({ width: z.number().min(1).max(10000), height: z.number().min(1).max(10000) }),
    paths: z.array(DrawingPathSchema).max(200).default([]),
    /**
     * A photo or traced picture of the device, stretched over the drawing's size. With one,
     * the paths may be left out: the controls are anchored on the picture.
     */
    image: ImageDataSchema.optional(),
    /**
     * Photos of the device, each a named view in its own box of the drawing. With them the
     * paths may be left out too. Two or more are shown with their names over them.
     */
    views: z.array(DrawingViewSchema).max(MAX_VIEWS).optional(),
    texts: z.array(DrawingTextSchema).max(60).default([]),
    controls: z.array(PhysicalControlSchema).min(1).max(200),
    /** How much room the labels get, in canvas units (the canvas is 1000 wide). */
    columnWidth: z.number().min(120).max(400).default(300),
  })
  .superRefine((drawing, ctx) => {
    const chars = drawingPictureChars(drawing);
    if (chars > MAX_PICTURE_CHARS) ctx.addIssue({ code: 'custom', message: tooMuchPicture(chars) });
  });
export type DeviceDrawing = z.infer<typeof DeviceDrawingSchema>;

/**
 * What a user changed on a drawing in the editor, kept in their own layout file for the
 * device (`drawing` in the layout format): where a control really is, which side its label
 * goes, what it is called. `custom` is a whole drawing of their own (an imported template,
 * or a photo with the controls placed on it), used instead of a shipped one.
 */
const point = z.object({ x: coordinate, y: coordinate });
export const DrawingChangesSchema = z.object({
  anchors: z.record(z.string().max(40), point).default({}),
  sides: z.record(z.string().max(40), z.enum(SIDES)).default({}),
  names: z.record(z.string().max(40), z.string().min(1).max(60)).default({}),
  custom: z.lazy(() => DeviceDrawingSchema).optional(),
});
export type DrawingChanges = z.infer<typeof DrawingChangesSchema>;

/** A drawing with the user's changes applied; anchors are kept on the drawing. */
export function applyChanges(
  drawing: DeviceDrawing,
  changes: Partial<DrawingChanges> | undefined
): DeviceDrawing {
  if (!changes) return drawing;
  const { width, height } = drawing.size;
  return {
    ...drawing,
    controls: drawing.controls.map((control) => {
      const at = changes.anchors?.[control.id];
      const side = changes.sides?.[control.id];
      const name = changes.names?.[control.id];
      return {
        ...control,
        ...(at
          ? {
              at: {
                x: Math.max(0, Math.min(width, at.x)),
                y: Math.max(0, Math.min(height, at.y)),
              },
            }
          : {}),
        ...(side ? { side } : {}),
        ...(name ? { name } : {}),
      };
    }),
  };
}

/** True when a drawing is for this device: its vendor and product id, or a part of its name. */
export function drawingMatches(
  drawing: Pick<DeviceDrawing, 'match'>,
  device: {
    vendorId?: string | undefined;
    productId?: string | undefined;
    name?: string | undefined;
  }
): boolean {
  if (!device.vendorId || drawing.match.vendorId !== device.vendorId.toUpperCase()) return false;
  if (device.productId && drawing.match.productIds.includes(device.productId.toUpperCase())) {
    return true;
  }
  const name = (device.name ?? '').toUpperCase();
  return name !== '' && drawing.match.names.some((part) => name.includes(part.toUpperCase()));
}
export type DeviceDrawingInput = z.input<typeof DeviceDrawingSchema>;

/** Every input id a drawing places. */
export function drawnInputs(drawing: Pick<DeviceDrawing, 'controls'>): Set<string> {
  const ids = new Set<string>();
  for (const control of drawing.controls) for (const input of control.inputs) ids.add(input.id);
  return ids;
}

/** The inputs a drawing marks as where their control rests (`rest`), held with no hand on it. */
export function restInputs(drawing: Pick<DeviceDrawing, 'controls'>): Set<string> {
  const ids = new Set<string>();
  for (const control of drawing.controls) {
    for (const input of control.inputs) if (input.rest) ids.add(input.id);
  }
  return ids;
}

/**
 * The box around the points of a path's absolute commands. Curves are bounded by their
 * control points, which is enough to say whether an anchor is on the thing drawn.
 */
export function pathBox(d: string): { x: number; y: number; w: number; h: number } | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of d.match(/[MLCQA][^MLHVCQAZ]*/g) ?? []) {
    const values =
      command
        .slice(1)
        .match(/-?\d+(\.\d+)?/g)
        ?.map(Number) ?? [];
    if (command[0] === 'A') {
      // An arc is rx ry rotation large-arc sweep x y: only the end point is a place.
      for (let i = 5; i + 1 < values.length; i += 7) {
        xs.push(values[i]!);
        ys.push(values[i + 1]!);
      }
      continue;
    }
    for (let i = 0; i + 1 < values.length; i += 2) {
      xs.push(values[i]!);
      ys.push(values[i + 1]!);
    }
  }
  if (xs.length === 0) return undefined;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Validates a drawing the way an imported file would be, with a reason in words. */
export function parseDrawing(
  raw: unknown
): { ok: true; drawing: DeviceDrawing } | { ok: false; reason: string } {
  const parsed = DeviceDrawingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: z.prettifyError(parsed.error) };
  const views = parsed.data.views ?? [];
  if (parsed.data.paths.length === 0 && !parsed.data.image && views.length === 0) {
    return { ok: false, reason: 'A drawing needs paths or a picture of the device.' };
  }
  for (const view of views) {
    const { width, height } = parsed.data.size;
    if (view.x < 0 || view.y < 0 || view.x + view.w > width + 1 || view.y + view.h > height + 1) {
      return { ok: false, reason: `The photo "${view.name}" lies outside the drawing.` };
    }
  }
  const seen = new Set<string>();
  for (const control of parsed.data.controls) {
    for (const input of control.inputs) {
      if (seen.has(input.id)) {
        return { ok: false, reason: `The input ${input.id} is on more than one control.` };
      }
      seen.add(input.id);
    }
    const { width, height } = parsed.data.size;
    const { x, y } = control.at;
    if (x < 0 || y < 0 || x > width || y > height) {
      return { ok: false, reason: `The control ${control.id} is anchored outside the drawing.` };
    }
  }
  return { ok: true, drawing: parsed.data };
}
