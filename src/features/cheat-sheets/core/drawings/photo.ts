import { compareControlIds, controlName, HAT_ARROWS, HAT_DIRECTIONS } from '../layout';
import { reportedIds, type NamedControl, type ReportedShape } from './callouts';
import {
  DRAWING_FORMAT,
  DRAWING_VERSION,
  drawnInputs,
  MAX_VIEWS,
  type DeviceDrawing,
  type DrawingView,
  type PhysicalControl,
  type Side,
} from './silhouette';

/**
 * A drawing made from the user's own photos of a device RigReady has no drawing of.
 *
 * The photos are the drawing: one or more named views ("Front", "Back") stacked down the
 * page, each as wide as the others. A control is put on a photo by pressing it on the
 * device and clicking its place; the ways of one hat and its press share one place. All
 * of it is plain data in the layout file of the device model, in RigReady's own folder;
 * the sheet, the trainer, the print and the kneeboard draw it like any other drawing.
 *
 * Everything here is pure: a drawing in, a new drawing out. The editor keeps the undo.
 */

/** Every photo is this wide on the drawing; its height follows its shape. */
export const PHOTO_WIDTH = 500;
/** Room between two photos, and over each for its name when there are several. */
const VIEW_GAP = 16;
export const CAPTION_HEIGHT = 28;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 1400;

interface Point {
  x: number;
  y: number;
}

/** A picture as it comes from a file: the data and its size in pixels. */
export interface Photo {
  image: string;
  width: number;
  height: number;
}

/** The photos of a drawing: its views, or the one picture of a drawing made before views. */
export function photoViews(
  drawing: Pick<DeviceDrawing, 'views' | 'image' | 'size'>
): DrawingView[] {
  if (drawing.views && drawing.views.length > 0) return drawing.views;
  if (!drawing.image) return [];
  const { width, height } = drawing.size;
  return [{ name: 'Photo 1', image: drawing.image, x: 0, y: 0, w: width, h: height }];
}

/** True for a drawing whose picture is the user's photos. */
export function isPhotoDrawing(drawing: Pick<DeviceDrawing, 'views' | 'image' | 'size'>): boolean {
  return photoViews(drawing).length > 0;
}

/** True when the names of the photos are shown over them. */
export const viewsAreNamed = (views: unknown[]): boolean => views.length > 1;

type Loose = Pick<DrawingView, 'name' | 'image' | 'w' | 'h'>;

/** The photos one under the other, each the full width, with room for the names of several. */
function arrange(views: Loose[]): { views: DrawingView[]; size: DeviceDrawing['size'] } {
  let y = 0;
  const out = views.map((view): DrawingView => {
    const shaped = (PHOTO_WIDTH * view.h) / Math.max(1, view.w);
    const h = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, shaped)));
    if (viewsAreNamed(views)) y += CAPTION_HEIGHT;
    const placed = { name: view.name, image: view.image, x: 0, y, w: PHOTO_WIDTH, h };
    y += h + VIEW_GAP;
    return placed;
  });
  return { views: out, size: { width: PHOTO_WIDTH, height: Math.max(1, y - VIEW_GAP) } };
}

/** The photo a point is on, or the nearest one; -1 when there is no photo. */
export function viewAt(views: DrawingView[], at: Point): number {
  let best = -1;
  let least = Infinity;
  views.forEach((view, index) => {
    const dx = Math.max(view.x - at.x, 0, at.x - (view.x + view.w));
    const dy = Math.max(view.y - at.y, 0, at.y - (view.y + view.h));
    const distance = Math.hypot(dx, dy);
    if (distance < least) {
      least = distance;
      best = index;
    }
  });
  return best;
}

/** A point moved onto the nearest photo: a control is never placed between two photos. */
export function ontoPhoto(drawing: DeviceDrawing, at: Point): Point {
  const views = photoViews(drawing);
  const view = views[viewAt(views, at)];
  const box = view ?? { x: 0, y: 0, w: drawing.size.width, h: drawing.size.height };
  return {
    x: Math.round(Math.max(box.x, Math.min(box.x + box.w, at.x))),
    y: Math.round(Math.max(box.y, Math.min(box.y + box.h, at.y))),
  };
}

/**
 * The drawing with these photos in place of its own. `from` says which photo of before
 * each one continues: its controls keep their place on it. Controls of a photo that is
 * not continued are taken off.
 */
function withViews(drawing: DeviceDrawing, next: { view: Loose; from?: number }[]): DeviceDrawing {
  const before = photoViews(drawing);
  const arranged = arrange(next.map((item) => item.view));
  const controls: PhysicalControl[] = [];
  for (const control of drawing.controls) {
    const old = viewAt(before, control.at);
    const to = next.findIndex((item) => item.from === old);
    const a = before[old];
    const b = arranged.views[to];
    if (!a || !b) continue;
    controls.push({
      ...control,
      at: {
        x: Math.round(b.x + ((control.at.x - a.x) / a.w) * b.w),
        y: Math.round(b.y + ((control.at.y - a.y) / a.h) * b.h),
      },
    });
  }
  const rest = { ...drawing };
  delete rest.image;
  return { ...rest, views: arranged.views, size: arranged.size, controls };
}

const kept = (drawing: DeviceDrawing): { view: Loose; from: number }[] =>
  photoViews(drawing).map((view, from) => ({ view, from }));

const loose = (photo: Photo, name: string): Loose => ({
  name: name.trim().slice(0, 40) || 'Photo',
  image: photo.image,
  w: photo.width,
  h: photo.height,
});

/** "Photo 2": a name for the next photo that no photo has yet. */
export function nextViewName(drawing: DeviceDrawing): string {
  const names = new Set(photoViews(drawing).map((view) => view.name));
  let n = names.size + 1;
  while (names.has(`Photo ${n}`)) n += 1;
  return `Photo ${n}`;
}

/** A drawing of the user's own from one photo, with nothing placed on it yet. */
export function photoDrawing(
  device: { title: string; vendorId: string; productId: string },
  photo: Photo,
  name = 'Photo 1'
): DeviceDrawing {
  const arranged = arrange([loose(photo, name)]);
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_VERSION,
    name: `${device.title} (my photos)`.slice(0, 120),
    match: {
      vendorId: device.vendorId.toUpperCase(),
      productIds: [device.productId.toUpperCase()],
      names: [],
    },
    view: 'Photos of the device',
    size: arranged.size,
    paths: [],
    texts: [],
    views: arranged.views,
    controls: [],
    columnWidth: 300,
  };
}

/** One more photo under the others. Undefined when the drawing is full. */
export function addView(
  drawing: DeviceDrawing,
  photo: Photo,
  name = nextViewName(drawing)
): DeviceDrawing | undefined {
  const now = kept(drawing);
  if (now.length >= MAX_VIEWS) return undefined;
  return withViews(drawing, [...now, { view: loose(photo, name) }]);
}

/** Another picture for one photo; what was placed on it stays where it was, in proportion. */
export function replaceView(drawing: DeviceDrawing, index: number, photo: Photo): DeviceDrawing {
  return withViews(
    drawing,
    kept(drawing).map((item, i) =>
      i === index ? { view: loose(photo, item.view.name), from: item.from } : item
    )
  );
}

/** One photo less; what was placed on it is not placed any more. */
export function removeView(drawing: DeviceDrawing, index: number): DeviceDrawing {
  return withViews(
    drawing,
    kept(drawing).filter((_, i) => i !== index)
  );
}

export function renameView(drawing: DeviceDrawing, index: number, name: string): DeviceDrawing {
  return withViews(
    drawing,
    kept(drawing).map((item, i) =>
      i === index
        ? { view: { ...item.view, name: name.trim().slice(0, 40) || item.view.name }, from: i }
        : item
    )
  );
}

// ---- controls ----

const DRAFT = { at: { x: 0, y: 0 }, hidden: false, assumed: false } as const;

/** A hat as Windows reports one: eight ways, with the button it presses when it has one. */
export function povHat(hat: number, press?: string): PhysicalControl {
  return {
    ...DRAFT,
    id: `hat-${hat}`,
    name: `Hat ${hat}`,
    glyph: 'hat',
    inputs: [
      ...HAT_DIRECTIONS.map((way) => ({ id: `hat:${hat}:${way}`, tag: HAT_ARROWS[way] })),
      ...(press ? [{ id: press, tag: 'press' }] : []),
    ],
  };
}

/** A control RigReady knows by name on this model, as a control of a drawing. */
function namedControl(known: NamedControl): PhysicalControl {
  const ids = known.inputs.map((input) => input.id);
  const glyph = ids.every((id) => id.startsWith('axis:'))
    ? 'axis'
    : ids.length > 2 || ids.some((id) => id.startsWith('hat:'))
      ? 'hat'
      : 'button';
  return {
    ...DRAFT,
    id: known.id,
    name: known.name,
    glyph,
    inputs: known.inputs.map((input) => ({ ...input })),
  };
}

/**
 * The named control an input belongs to: the one that lists it, or the one that names the
 * hat it is a way of (a four-way hat pushed to a corner is still that hat).
 */
function knownOf(id: string, named: NamedControl[]): NamedControl | undefined {
  const listed = named.find((control) => control.inputs.some((input) => input.id === id));
  if (listed) return listed;
  const hat = /^(hat:\d):/.exec(id);
  if (!hat) return undefined;
  return named.find((control) => control.inputs.some((i) => i.id.startsWith(`${hat[1]}:`)));
}

/**
 * The control a press belongs to. On a model RigReady knows the controls of (`named`):
 * the whole control by its maker's name, every way of it. Otherwise a button or an axis
 * by itself, or the whole hat for one way of a hat Windows reports as a hat.
 */
export function controlOfInput(id: string, named: NamedControl[] = []): PhysicalControl {
  const known = knownOf(id, named);
  if (known) return namedControl(known);
  const hat = /^hat:(\d):/.exec(id);
  if (hat) return povHat(Number(hat[1]));
  return {
    ...DRAFT,
    id: id.replace(':', '-'),
    name: controlName(id),
    glyph: id.startsWith('axis:') ? 'axis' : 'button',
    inputs: [{ id }],
  };
}

/** The ways of a hat, in the order the user is asked for them and the sheet shows them. */
export const HAT_WAYS = [
  { key: 'up', tag: '↑', ask: 'Push the hat up.' },
  { key: 'right', tag: '→', ask: 'Push it to the right.' },
  { key: 'down', tag: '↓', ask: 'Push it down.' },
  { key: 'left', tag: '←', ask: 'Push it to the left.' },
  { key: 'press', tag: 'press', ask: 'Press it in.' },
] as const;
export type HatWay = (typeof HAT_WAYS)[number]['key'];
export type HatWays = Partial<Record<HatWay, string>>;

/** The hat Windows reports as a hat that one of these ways belongs to, if any. */
export function povOf(ways: HatWays): number | undefined {
  for (const way of HAT_WAYS) {
    const hat = /^hat:(\d):/.exec(ways[way.key] ?? '');
    if (hat && way.key !== 'press') return Number(hat[1]);
  }
  return undefined;
}

/**
 * One hat from what its ways press: the buttons of a hat that reports buttons, each with
 * its arrow, or the hat Windows reports with its press. One control, so one place on the
 * photo and one block of labels. Undefined while no way is known.
 */
export function hatGroup(ways: HatWays, name: string): PhysicalControl | undefined {
  const pov = povOf(ways);
  if (pov !== undefined) {
    const press = ways.press && !ways.press.startsWith('hat:') ? ways.press : undefined;
    return { ...povHat(pov, press), name };
  }
  const seen = new Set<string>();
  const inputs = HAT_WAYS.flatMap((way) => {
    const id = ways[way.key];
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, tag: way.tag }];
  });
  if (inputs.length === 0) return undefined;
  return {
    ...DRAFT,
    id: `hat-${inputs[0]!.id.replace(':', '-')}`,
    name,
    glyph: 'hat',
    inputs,
  };
}

/** "Hat 2": a name for the next hat that neither Windows nor the drawing uses. */
export function nextHatName(drawing: DeviceDrawing, reports: ReportedShape | undefined): string {
  const names = new Set(drawing.controls.map((control) => control.name));
  let n = (reports?.hats ?? 0) + 1;
  while (names.has(`Hat ${n}`)) n += 1;
  return `Hat ${n}`;
}

/** The placed control an input belongs to. */
export function controlWith(drawing: DeviceDrawing, input: string): PhysicalControl | undefined {
  return drawing.controls.find((control) => control.inputs.some((i) => i.id === input));
}

/**
 * Puts a control on the photo at a point, or moves it there. Its inputs are its own from
 * then on: another control that had one of them loses it, and is taken off when none is
 * left (a button placed alone that turned out to be one way of a hat).
 */
export function place(drawing: DeviceDrawing, control: PhysicalControl, at: Point): DeviceDrawing {
  const taken = new Set(control.inputs.map((input) => input.id));
  const others = drawing.controls
    .filter((other) => other.id !== control.id)
    .map((other) =>
      other.inputs.some((input) => taken.has(input.id))
        ? { ...other, inputs: other.inputs.filter((input) => !taken.has(input.id)) }
        : other
    )
    .filter((other) => other.inputs.length > 0);
  return { ...drawing, controls: [...others, { ...control, at: ontoPhoto(drawing, at) }] };
}

const change = (
  drawing: DeviceDrawing,
  id: string,
  with_: (control: PhysicalControl) => PhysicalControl
): DeviceDrawing => ({
  ...drawing,
  controls: drawing.controls.map((control) => (control.id === id ? with_(control) : control)),
});

/** Moves a placed control to a point, kept on a photo. */
export function moveTo(drawing: DeviceDrawing, id: string, at: Point): DeviceDrawing {
  return change(drawing, id, (control) => ({ ...control, at: ontoPhoto(drawing, at) }));
}

/** Takes a control off the photo: its inputs are not placed any more. */
export function takeOff(drawing: DeviceDrawing, id: string): DeviceDrawing {
  return { ...drawing, controls: drawing.controls.filter((control) => control.id !== id) };
}

export function renameControl(drawing: DeviceDrawing, id: string, name: string): DeviceDrawing {
  const clean = name.trim().slice(0, 60);
  return clean ? change(drawing, id, (control) => ({ ...control, name: clean })) : drawing;
}

/** Which side the label of a control goes on; undefined is the side it is nearer to. */
export function sideControl(
  drawing: DeviceDrawing,
  id: string,
  side: Side | undefined
): DeviceDrawing {
  return change(drawing, id, (control) => {
    const next = { ...control };
    if (side) next.side = side;
    else delete next.side;
    return next;
  });
}

// ---- what is placed and what is not ----

/** Something of the device with no place yet: a button, an axis, a whole hat, a named control. */
export interface Unplaced {
  /** `button:5`, `axis:X`, `hat:1` for a hat Windows reports, `named:tms` for a known control. */
  key: string;
  /** "5", "X axis", "Hat 1", "H2 TMS hat": what its chip says. */
  label: string;
  /** One of its inputs: `controlOfInput` of it is the control to place. */
  input: string;
  /** Something is bound to it in the game the sheet is of. */
  bound: boolean;
}

export interface Placement {
  /** Buttons, axes and hats the device has (a hat counts once). */
  total: number;
  placed: number;
  unplaced: Unplaced[];
  /** "Buttons 13 to 40, Z axis, Hat 1": the unplaced ones in words; empty when none. */
  text: string;
}

/** Runs of numbers in words: 3, 5, 6, 7 gives "Button 3, Buttons 5 to 7". */
function buttonRuns(numbers: number[]): string[] {
  const out: string[] = [];
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    if (j === i) out.push(`Button ${sorted[i]}`);
    else if (j === i + 1) out.push(`Buttons ${sorted[i]} and ${sorted[j]}`);
    else out.push(`Buttons ${sorted[i]} to ${sorted[j]}`);
    i = j + 1;
  }
  return out;
}

/**
 * How far a photo drawing is: of everything the device reports and everything that is
 * bound on it, what has a place on a photo and what does not yet. A hat counts once, and
 * so does a control RigReady knows by name (`named`) with all its ways.
 */
export function placement(
  drawing: Pick<DeviceDrawing, 'controls'>,
  reports: ReportedShape | undefined,
  bound: Iterable<string>,
  named: NamedControl[] = []
): Placement {
  const unit = (id: string): string => {
    const control = knownOf(id, named);
    return control ? `named:${control.id}` : id.replace(/^(hat:\d):.*$/, '$1');
  };
  const done = new Set([...drawnInputs(drawing)].map(unit));
  const does = new Set([...bound].map(unit));
  const inputs = [...new Set([...(reports ? reportedIds(reports) : []), ...bound])].sort(
    compareControlIds
  );
  // Each thing once, in the order of its first input.
  const first = new Map<string, string>();
  for (const id of [...inputs, ...drawnInputs(drawing)]) {
    if (!first.has(unit(id))) first.set(unit(id), id);
  }
  const unplaced = [...first]
    .filter(([key]) => !done.has(key))
    .map(([key, input]): Unplaced => {
      const [kind, n] = key.split(':');
      const label =
        knownOf(input, named)?.name ??
        (kind === 'button' ? String(n) : kind === 'hat' ? `Hat ${n}` : controlName(key));
      return { key, label, input, bound: does.has(key) };
    });
  const buttons = unplaced.filter((u) => u.key.startsWith('button:')).map((u) => Number(u.label));
  const text = [
    ...buttonRuns(buttons),
    ...unplaced.filter((u) => !u.key.startsWith('button:')).map((u) => u.label),
  ].join(', ');
  return { total: first.size, placed: first.size - unplaced.length, unplaced, text };
}
