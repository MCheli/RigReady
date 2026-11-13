import type { DisplayTarget, Rotation } from '../../../shared/models';

/**
 * Keeping monitors next to each other when one of them changes size or goes away.
 *
 * Windows wants the monitors of a desktop to touch and not overlap. A monitor turned a
 * quarter swaps its width and height, and a monitor switched off leaves a hole; in both
 * cases the others have to move, and nobody should have to work the numbers out by hand.
 * Everything here is arithmetic on boxes: nothing reads or changes the monitors.
 */
export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const sideways = (r: Rotation): boolean => r === 90 || r === 270;

/** True when two boxes share an area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every pair of boxes that overlap. Empty for an arrangement Windows can take. */
export function overlaps(boxes: Box[]): [Box, Box][] {
  const pairs: [Box, Box][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i]!, boxes[j]!)) pairs.push([boxes[i]!, boxes[j]!]);
    }
  }
  return pairs;
}

const rowsMeet = (a: Box, b: Box): boolean => a.y < b.y + b.height && b.y < a.y + a.height;
const columnsMeet = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width;

/**
 * The boxes that follow `from` when its right edge (or, with `down`, its bottom edge)
 * moves: those at or beyond that edge and level with it, and in turn those at or beyond
 * theirs. They keep their distances to each other.
 */
function followers(boxes: Box[], from: Box, down: boolean): Set<string> {
  const moving = new Set<string>();
  const edges: Box[] = [from];
  let grew = true;
  while (grew) {
    grew = false;
    for (const box of boxes) {
      if (box.id === from.id || moving.has(box.id)) continue;
      const follows = edges.some((edge) =>
        down
          ? box.y >= edge.y + edge.height && columnsMeet(box, edge)
          : box.x >= edge.x + edge.width && rowsMeet(box, edge)
      );
      if (!follows) continue;
      moving.add(box.id);
      edges.push(box);
      grew = true;
    }
  }
  return moving;
}

/**
 * One monitor gets a new size (it was turned a quarter). Its top left corner stays where
 * it is. What was to its right moves by the change in width, what was below it by the
 * change in height, and whatever sits beyond those moves with them.
 *
 * The answer can still hold an overlap in an unusual arrangement: check with `overlaps`.
 */
export function resized(boxes: Box[], id: string, width: number, height: number): Box[] {
  const old = boxes.find((b) => b.id === id);
  if (!old) return boxes;
  const dx = width - old.width;
  const dy = height - old.height;
  // Sideways first. A box counts as level with this one over its taller shape, old or new.
  const tall = { ...old, height: Math.max(old.height, height) };
  const right = followers(boxes, tall, false);
  const shifted = boxes.map((b) => (right.has(b.id) ? { ...b, x: b.x + dx } : b));
  // Then down, against the width it has now.
  const wide = { ...old, width };
  const below = followers(shifted, wide, true);
  return shifted.map((b) => {
    if (b.id === id) return { ...b, width, height };
    return below.has(b.id) ? { ...b, y: b.y + dy } : b;
  });
}

export interface QuarterTurn {
  boxes: Box[];
  /** The other boxes that moved to stay next to the turned one. */
  moved: string[];
  /** False when moving them would put one box over another: only the turned box changed. */
  fitted: boolean;
}

/**
 * One box turned a quarter: its width and height swap, and the boxes next to it move so
 * that they stay next to it. The arrangement editor uses this for the monitor being turned.
 */
export function quarterTurned(boxes: Box[], id: string): QuarterTurn {
  const old = boxes.find((b) => b.id === id);
  if (!old) return { boxes, moved: [], fitted: true };
  const next = resized(boxes, id, old.height, old.width);
  if (overlaps(next).length > 0) {
    const alone = boxes.map((b) => (b.id === id ? { ...b, width: b.height, height: b.width } : b));
    return { boxes: alone, moved: [], fitted: false };
  }
  const was = new Map(boxes.map((b) => [b.id, b]));
  const moved = next
    .filter((b) => b.id !== id && (b.x !== was.get(b.id)?.x || b.y !== was.get(b.id)?.y))
    .map((b) => b.id);
  return { boxes: next, moved, fitted: true };
}

/**
 * One monitor goes away (it is switched off). What was to its right closes up by its
 * width; when nothing was, what was below it closes up by its height.
 */
export function removed(boxes: Box[], id: string): Box[] {
  const gone = boxes.find((b) => b.id === id);
  if (!gone) return boxes;
  const rest = boxes.filter((b) => b.id !== id);
  const right = followers(boxes, gone, false);
  if (right.size > 0) {
    return rest.map((b) => (right.has(b.id) ? { ...b, x: b.x - gone.width } : b));
  }
  const below = followers(boxes, gone, true);
  return rest.map((b) => (below.has(b.id) ? { ...b, y: b.y - gone.height } : b));
}

/** The same arrangement with one box (the main display) at 0,0, as Windows has it. */
export function anchored(boxes: Box[], mainId: string | undefined): Box[] {
  const main = boxes.find((b) => b.id === mainId);
  if (!main || (main.x === 0 && main.y === 0)) return boxes;
  return boxes.map((b) => ({ ...b, x: b.x - main.x, y: b.y - main.y }));
}

/** The rotation after a quarter or half turn. */
export function turnedBy(rotation: Rotation, by: 90 | 180 | 270): Rotation {
  return ((rotation + by) % 360) as Rotation;
}

/**
 * Identify draws an arrow that points to the top of the picture. Where a person sees it
 * point tells how far the picture must turn to be upright.
 *
 * Measured on the owner's rig (docs/research/owner-rig.md): a panel mounted a quarter turn
 * clockwise shows a landscape picture (0°) with its top to the right, and is upright at
 * 90° ("Portrait"). So each 90° more turns the picture a quarter against the clock:
 * an arrow seen pointing right needs 90° more, one pointing left 270° more (a quarter the
 * other way), one pointing down 180°.
 */
export type ArrowSeen = 'right' | 'down' | 'left';
export function turnForArrow(arrow: ArrowSeen): 90 | 180 | 270 {
  return arrow === 'right' ? 90 : arrow === 'left' ? 270 : 180;
}

export interface Turned {
  /** The layout with the monitor turned. */
  displays: DisplayTarget[];
  /** False when the other monitors could not be moved to fit: positions are as they were. */
  fitted: boolean;
}

/**
 * Turns one monitor of a layout to `rotation`. A quarter turn swaps its width and height,
 * and the monitors next to it are moved so that they still touch and do not overlap.
 * `sizes` gives the desktop size of a monitor the layout holds no size for.
 */
export function turnInLayout(
  displays: DisplayTarget[],
  id: string,
  rotation: Rotation,
  sizes: (target: DisplayTarget) => { width: number; height: number } | undefined = () => undefined
): Turned {
  const key = id.toLowerCase();
  const target = displays.find((d) => d.id.toLowerCase() === key);
  if (!target || !target.enabled) return { displays, fitted: true };
  const quarter = sideways(target.rotation) !== sideways(rotation);
  const swap = (d: DisplayTarget): DisplayTarget =>
    d.width !== undefined && d.height !== undefined
      ? { ...d, rotation, width: d.height, height: d.width }
      : { ...d, rotation };
  const plain = displays.map((d) => (d === target ? (quarter ? swap(d) : { ...d, rotation }) : d));
  if (!quarter) return { displays: plain, fitted: true };

  const on = displays.filter((d) => d.enabled);
  const boxes: Box[] = [];
  for (const d of on) {
    const size =
      d.width !== undefined && d.height !== undefined
        ? { width: d.width, height: d.height }
        : sizes(d);
    // Without every size there is no telling what touches what.
    if (!size) return { displays: plain, fitted: false };
    boxes.push({ id: d.id.toLowerCase(), x: d.x, y: d.y, ...size });
  }
  const old = boxes.find((b) => b.id === key)!;
  const main = on.find((d) => d.primary)?.id.toLowerCase();
  const moved = anchored(resized(boxes, key, old.height, old.width), main);
  if (overlaps(moved).length > 0) return { displays: plain, fitted: false };
  const at = new Map(moved.map((b) => [b.id, b]));
  return {
    displays: plain.map((d) => {
      const box = d.enabled ? at.get(d.id.toLowerCase()) : undefined;
      return box ? { ...d, x: box.x, y: box.y } : d;
    }),
    fitted: true,
  };
}

/**
 * A layout made from the monitors as they are, with only the chosen ones left on. Every
 * connected monitor is listed, the others as off, so that applying the layout switches
 * them off. The ones left on close up where one between them went, and when the main
 * display is switched off the one nearest the top left becomes the main display.
 */
export function keepOnly(current: DisplayTarget[], stayOn: string[]): DisplayTarget[] {
  const keep = new Set(stayOn.map((id) => id.toLowerCase()));
  const on = current.filter((d) => d.enabled);
  let boxes: Box[] = on.map((d) => ({
    id: d.id.toLowerCase(),
    x: d.x,
    y: d.y,
    width: d.width ?? 0,
    height: d.height ?? 0,
  }));
  const before = boxes;
  for (const d of on) {
    if (!keep.has(d.id.toLowerCase())) boxes = removed(boxes, d.id.toLowerCase());
  }
  // Closing up must never put one screen over another: then they stay where they are.
  if (overlaps(boxes).length > 0) boxes = before.filter((b) => keep.has(b.id));
  const staying = on.filter((d) => keep.has(d.id.toLowerCase()));
  const main =
    staying.find((d) => d.primary)?.id.toLowerCase() ??
    [...boxes].sort((a, b) => a.x - b.x || a.y - b.y)[0]?.id;
  const at = new Map(anchored(boxes, main).map((b) => [b.id, b]));
  return current.map((d) => {
    const id = d.id.toLowerCase();
    const box = at.get(id);
    const identity = {
      ...(d.serial ? { serial: d.serial } : {}),
      ...(d.usbSerial ? { usbSerial: d.usbSerial } : {}),
    };
    if (!d.enabled || !box) {
      return {
        id: d.id,
        name: d.name,
        enabled: false,
        primary: false,
        x: 0,
        y: 0,
        rotation: 0 as const,
        ...identity,
      };
    }
    return { ...d, primary: id === main, x: box.x, y: box.y };
  });
}
