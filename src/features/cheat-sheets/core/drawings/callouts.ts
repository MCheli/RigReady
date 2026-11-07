import type { CategoryId } from '../categories';
import { compareControlIds, controlShort, HAT_ARROWS, HAT_DIRECTIONS } from '../layout';
import { textWidth } from '../render';
import type { SheetControl } from '../sheet';
import type { DeviceDrawing, PhysicalControl, Side } from './silhouette';

/**
 * Places the labels of a device around its drawing.
 *
 * One label block per physical control (a hat is one block with a row per direction),
 * in a column left and right of the drawing (and a row above and below it, for a bezel),
 * each with a one-bend leader line to the control. Blocks on a side are ordered the way
 * their controls are down the drawing and stacked so that each sits as close to its
 * control as the others allow; where two leaders would still cross, their blocks trade
 * places. Pure arithmetic in canvas units: nothing here asks a browser.
 */

export const CANVAS_WIDTH = 1000;
const MARGIN = 16;
/** Between two blocks of a column. */
const GAP = 10;
/** Between a column and the drawing: room for the leader's horizontal stub. */
const BAND_GAP = 26;
/** Inside a block. */
const PAD = 7;
const HEAD_SIZE = 10.5;
const ROW_SIZE = 14;
const LINE_HEIGHT = 1.16;
/** The straight stub of a leader just outside its block. */
const STUB = 14;
/** The square that says what kind of action a row is. */
export const MARK = 8;
/** The most rows of text one line of a label may wrap to. */
const MAX_LINES = 3;
/** A drawing is never blown up more than this; a small one gets wide margins instead. */
const MAX_SCALE = 1.25;
/** With `fill` asked for, this much more, as long as the columns keep their minimum width. */
const MAX_FILL_SCALE = 1.35;
/** A column narrower than this wraps every other label; `fill` stops here. */
const MIN_COLUMN = 250;
/** A block in a row above or below the drawing is never wider than this. */
const ROW_MAX_WIDTH = 330;

export interface Point {
  x: number;
  y: number;
}

export interface Row {
  /** The input this row is for. */
  id: string;
  /** The word for the input on this control ("↑", "IDLE"), set in bold before the text. */
  tag?: string;
  /** The modifier, bold, before the action ("LCtrl:"). */
  bold?: string;
  /** The whole text as measured, tag and modifier included. */
  text: string;
  /** The text wrapped to the block's width. */
  lines: string[];
  kind?: CategoryId;
  /** A game default, or an input nothing is bound to: drawn muted. */
  dim: boolean;
  note?: boolean;
}

export interface Callout {
  control: PhysicalControl;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "TMS · 37–40". */
  head: string;
  rows: Row[];
  size: number;
  /** The control on the canvas. */
  anchor: Point;
  /** From the control to the block: anchor, bend, block edge. */
  leader: Point[];
  /** Nothing bound on any of its inputs. */
  empty: boolean;
}

export interface PlacedDrawing {
  drawing: DeviceDrawing;
  x: number;
  y: number;
  scale: number;
}

export interface CalloutPlan {
  width: number;
  height: number;
  /** Absent for a device with no drawing: its labels are a list of blocks (`planList`). */
  placed?: PlacedDrawing;
  callouts: Callout[];
  /** Bound inputs that are not on the drawing, listed under it. */
  extras: Row[];
  /**
   * How far the label columns run on below the drawing, in canvas units. Past the
   * drawing, leaders get long and steep: a page that can choose its text size keeps this small.
   */
  overflow: number;
  extrasBox?: { x: number; y: number; w: number; h: number; columns: number };
}

export interface PlanOptions {
  /** Blocks for controls nothing is bound to, and rows for their unbound inputs. Default false. */
  showEmpty?: boolean;
  /** Makes label text larger or smaller. Default 1. */
  fontScale?: number;
  /**
   * The canvas height the picture is meant to fill (a kneeboard page is about 1230 for a
   * canvas 1000 wide): the drawing grows towards it, taking room from the columns down
   * to their minimum width. Without it the drawing takes the width the columns leave.
   */
  fill?: number;
  /**
   * Inputs listed under the drawing even with nothing to say (the trainer leaves every
   * label off, but each control that has an answer must still be on the picture to light).
   */
  listed?: string[];
}

/** Text wrapped at spaces to a width; a word wider than the box is broken, as a browser would. */
export function wrapText(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  const push = (): void => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    push();
    if (textWidth(word, size) <= width) {
      line = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (textWidth(piece + ch, size) > width && piece) {
        lines.push(piece);
        piece = '';
      }
      piece += ch;
    }
    line = piece;
  }
  push();
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  let last = kept[MAX_LINES - 1]!;
  while (last.length > 1 && textWidth(`${last}…`, size) > width) last = last.slice(0, -1).trimEnd();
  kept[MAX_LINES - 1] = `${last}…`;
  return kept;
}

/** "37–40" for buttons 37, 38, 39, 40; "H1" for a hat; "RX, RY, 26" otherwise. */
export function numbersOf(control: PhysicalControl): string {
  const ids = control.inputs.map((input) => input.id);
  if (ids.length === 0) return '';
  const buttons = ids.map((id) => /^button:(\d+)$/.exec(id)?.[1]).map(Number);
  if (ids.length > 1 && buttons.every((n) => !Number.isNaN(n))) {
    const sorted = [...buttons].sort((a, b) => a - b);
    const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
    if (consecutive) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
    return sorted.join(', ');
  }
  const hat = /^hat:(\d):/.exec(ids[0]!);
  if (hat && ids.every((id) => id.startsWith(`hat:${hat[1]}:`))) return `H${hat[1]}`;
  return ids.map(controlShort).join(', ');
}

function rowsFor(
  control: PhysicalControl,
  byId: Map<string, SheetControl>,
  showEmpty: boolean
): Row[] {
  const rows: Row[] = [];
  for (const input of control.inputs) {
    const entry = byId.get(input.id);
    const bindings = entry?.bindings ?? [];
    for (const binding of bindings) {
      const bold = binding.modifiers.length > 0 ? `${binding.modifiers.join('+')}:` : undefined;
      const text = [input.tag, bold, binding.short].filter(Boolean).join(' ');
      rows.push({
        id: input.id,
        ...(input.tag ? { tag: input.tag } : {}),
        ...(bold ? { bold } : {}),
        text,
        lines: [],
        kind: binding.kind,
        dim: binding.source === 'default',
      });
    }
    if (entry?.note) {
      rows.push({
        id: input.id,
        ...(input.tag && bindings.length === 0 ? { tag: input.tag } : {}),
        text: `${input.tag && bindings.length === 0 ? `${input.tag} ` : ''}✎ ${entry.note}`,
        lines: [],
        dim: false,
        note: true,
      });
    }
    if (bindings.length === 0 && !entry?.note && showEmpty) {
      rows.push({
        id: input.id,
        ...(input.tag ? { tag: input.tag } : {}),
        text: input.tag ? `${input.tag} —` : '—',
        lines: [],
        dim: true,
      });
    }
  }
  return rows;
}

const centreOf = (drawing: DeviceDrawing): number => drawing.size.width / 2;

function sideOf(control: PhysicalControl, drawing: DeviceDrawing): Side {
  return control.side ?? (control.at.x < centreOf(drawing) ? 'left' : 'right');
}

interface Segment {
  a: Point;
  b: Point;
}

const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** True when two segments cross at a point that is inside both (touching ends do not count). */
export function segmentsCross(s: Segment, t: Segment): boolean {
  const d1 = cross(t.a, t.b, s.a);
  const d2 = cross(t.a, t.b, s.b);
  const d3 = cross(s.a, s.b, t.a);
  const d4 = cross(s.a, s.b, t.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const segmentsOf = (leader: Point[]): Segment[] =>
  leader.slice(1).map((b, i) => ({ a: leader[i]!, b }));

/** How many pairs of leader lines cross each other. */
export function crossings(callouts: Pick<Callout, 'leader'>[]): number {
  let count = 0;
  for (let i = 0; i < callouts.length; i++) {
    for (let j = i + 1; j < callouts.length; j++) {
      const a = segmentsOf(callouts[i]!.leader);
      const b = segmentsOf(callouts[j]!.leader);
      if (a.some((s) => b.some((t) => segmentsCross(s, t)))) count++;
    }
  }
  return count;
}

/**
 * Stacks blocks down a column: each as close to the middle of its control as the ones
 * before and after it allow, none overlapping, none above `top`. When they do not all
 * fit above `bottom`, the column runs on below it (the canvas grows).
 */
export function stack(items: { want: number; h: number }[], top: number, bottom: number): number[] {
  const n = items.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const want = items[i]!.want - items[i]!.h / 2;
    y[i] = Math.max(want, i === 0 ? top : y[i - 1]! + items[i - 1]!.h + GAP);
  }
  // The lowest each may go up to: the ones above it still need their room.
  const floor = new Array<number>(n);
  for (let i = 0; i < n; i++) floor[i] = i === 0 ? top : floor[i - 1]! + items[i - 1]!.h + GAP;
  for (let i = n - 1; i >= 0; i--) {
    const ceiling = i === n - 1 ? bottom - items[i]!.h : y[i + 1]! - GAP - items[i]!.h;
    y[i] = Math.max(floor[i]!, Math.min(y[i]!, ceiling));
  }
  for (let i = 1; i < n; i++) y[i] = Math.max(y[i]!, y[i - 1]! + items[i - 1]!.h + GAP);
  return y;
}

/**
 * Tries trading two blocks of a column or row at a time, keeping a trade whenever fewer
 * leaders cross, until none do or no trade helps. `apply` places a given order and says
 * how many leaders then cross. Leaves the best order applied.
 */
function untangle<T>(start: T[], apply: (order: T[]) => number): void {
  let order = start;
  let best = apply(order);
  for (let round = 0; best > 0 && round < order.length * 2; round++) {
    let improved = false;
    for (let i = 0; i < order.length - 1 && !improved; i++) {
      for (let j = i + 1; j < order.length && !improved; j++) {
        const swapped = [...order];
        [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
        const count = apply(swapped);
        if (count < best) {
          order = swapped;
          best = count;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  apply(order);
}

/** Lays one column out, then trades neighbours whose leaders cross until none do. */
function placeColumn(
  callouts: Callout[],
  side: 'left' | 'right',
  columnX: number,
  columnW: number,
  top: number,
  bottom: number
): void {
  const order = [...callouts].sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
  untangle(order, (list) => {
    const ys = stack(
      list.map((c) => ({ want: c.anchor.y, h: c.h })),
      top,
      bottom
    );
    list.forEach((c, i) => {
      c.x = columnX;
      c.y = ys[i]!;
      const ly = c.y + c.h / 2;
      const edge = side === 'left' ? columnX + columnW : columnX;
      const bend = side === 'left' ? edge + STUB : edge - STUB;
      c.leader = [c.anchor, { x: bend, y: ly }, { x: edge, y: ly }];
    });
    return crossings(list);
  });
}

/**
 * Lays a row of blocks above or below the drawing, left to right as their controls are:
 * each as close under (or over) its control as its neighbours allow, none wider than a
 * column, so a lone block sits by its control instead of across the page.
 */
function placeRow(
  callouts: Callout[],
  side: 'top' | 'bottom',
  left: number,
  width: number,
  y: number,
  maxWidth: number
): number {
  const order = [...callouts].sort((a, b) => a.anchor.x - b.anchor.x);
  const w = Math.min(maxWidth, (width - (order.length - 1) * GAP) / order.length);
  const tallest = Math.max(...order.map((c) => c.h));
  untangle(order, (list) => {
    const xs = stack(
      list.map((c) => ({ want: c.anchor.x, h: w })),
      left,
      left + width
    );
    list.forEach((c, i) => {
      c.x = xs[i]!;
      c.w = w;
      c.y = side === 'top' ? y + tallest - c.h : y;
      // Straight down (or up) when the block is under its control, else one bend.
      const cx = Math.max(c.x + 12, Math.min(c.x + w - 12, c.anchor.x));
      const edge = side === 'top' ? c.y + c.h : c.y;
      const bend = side === 'top' ? edge + STUB : edge - STUB;
      c.leader = [c.anchor, { x: cx, y: bend }, { x: cx, y: edge }];
    });
    return crossings(list);
  });
  return tallest;
}

/** The text of a block's rows wrapped to its width, and the height that needs. */
function measure(callout: Callout, scale: number): void {
  const inner = callout.w - 2 * PAD - MARK - 6;
  const size = ROW_SIZE * scale;
  let h = PAD + HEAD_SIZE * scale * LINE_HEIGHT + 3;
  for (const row of callout.rows) {
    row.lines = wrapText(row.text, inner, size);
    h += row.lines.length * size * LINE_HEIGHT + 2;
  }
  callout.h = Math.round((h + PAD) * 10) / 10;
  callout.size = size;
}

/**
 * The plan for one device: where the drawing goes, where every label goes, and the lines
 * between them.
 */
export function planCallouts(
  drawing: DeviceDrawing,
  controls: SheetControl[],
  options: PlanOptions = {}
): CalloutPlan {
  const showEmpty = options.showEmpty ?? false;
  const scale = options.fontScale ?? 1;
  const byId = new Map(controls.map((c) => [c.id, c]));
  let columnW = drawing.columnWidth;

  const callouts: Callout[] = [];
  for (const control of drawing.controls) {
    if (control.inputs.length === 0) continue;
    const rows = rowsFor(control, byId, showEmpty);
    const empty = !rows.some((row) => !row.dim || row.note);
    if (rows.length === 0 || (empty && !showEmpty && !rows.some((r) => r.kind))) continue;
    const numbers = numbersOf(control);
    const assumed = control.assumed ? ' ?' : '';
    callouts.push({
      control,
      side: sideOf(control, drawing),
      x: 0,
      y: 0,
      w: columnW,
      h: 0,
      head: numbers ? `${control.name} · ${numbers}${assumed}` : `${control.name}${assumed}`,
      rows,
      size: ROW_SIZE * scale,
      anchor: { x: 0, y: 0 },
      leader: [],
      empty,
    });
  }
  const on = (side: Side): Callout[] => callouts.filter((c) => c.side === side);
  const hasLeft = on('left').length > 0;
  const hasRight = on('right').length > 0;

  const rowWidth = (count: number): number =>
    Math.min(ROW_MAX_WIDTH, (CANVAS_WIDTH - 2 * MARGIN - (count - 1) * GAP) / count);
  for (const c of on('top')) c.w = rowWidth(on('top').length);
  for (const c of on('bottom')) c.w = rowWidth(on('bottom').length);
  for (const c of [...on('top'), ...on('bottom')]) measure(c, scale);
  const topRowH = on('top').length > 0 ? Math.max(...on('top').map((c) => c.h)) : 0;
  const bottomRowH = on('bottom').length > 0 ? Math.max(...on('bottom').map((c) => c.h)) : 0;

  // The drawing sits between the columns, scaled to the width that leaves them; asked
  // to fill a height, it grows and the columns give way down to their minimum width.
  const sides = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
  const bandFor = (column: number): number =>
    CANVAS_WIDTH - 2 * MARGIN - sides * (column + BAND_GAP);
  let drawScale = Math.min(MAX_SCALE, bandFor(columnW) / drawing.size.width);
  if (options.fill !== undefined && sides > 0) {
    const room =
      options.fill -
      2 * MARGIN -
      (topRowH ? topRowH + STUB + 16 : 0) -
      (bottomRowH ? bottomRowH + STUB + 16 : 0);
    const wanted = Math.min(MAX_FILL_SCALE, room / drawing.size.height);
    // Columns already narrower than the minimum (a bezel's) stay as they are.
    const minColumn = Math.min(MIN_COLUMN, columnW);
    const grown = Math.min(wanted, bandFor(minColumn) / drawing.size.width);
    if (grown > drawScale) {
      drawScale = grown;
      columnW = Math.max(
        minColumn,
        (CANVAS_WIDTH - 2 * MARGIN - drawing.size.width * drawScale) / sides - BAND_GAP
      );
      for (const c of [...on('left'), ...on('right')]) c.w = columnW;
    }
  }
  const bandX = MARGIN + (hasLeft ? columnW + BAND_GAP : 0);
  const bandW = bandFor(columnW);
  const drawW = drawing.size.width * drawScale;
  const drawH = drawing.size.height * drawScale;
  for (const c of [...on('left'), ...on('right')]) measure(c, scale);

  const drawY = MARGIN + (topRowH > 0 ? topRowH + STUB + 16 : 0);
  const placed: PlacedDrawing = {
    drawing,
    x: bandX + (bandW - drawW) / 2,
    y: drawY,
    scale: drawScale,
  };
  for (const c of callouts) {
    c.anchor = {
      x: placed.x + c.control.at.x * drawScale,
      y: placed.y + c.control.at.y * drawScale,
    };
  }

  if (topRowH > 0) {
    placeRow(on('top'), 'top', MARGIN, CANVAS_WIDTH - 2 * MARGIN, MARGIN, ROW_MAX_WIDTH);
  }
  const columnTop = drawY;
  const columnBottom = drawY + drawH;
  if (hasLeft) placeColumn(on('left'), 'left', MARGIN, columnW, columnTop, columnBottom);
  if (hasRight) {
    placeColumn(
      on('right'),
      'right',
      CANVAS_WIDTH - MARGIN - columnW,
      columnW,
      columnTop,
      columnBottom
    );
  }
  const sideBottom = Math.max(
    columnBottom,
    ...callouts.filter((c) => c.side === 'left' || c.side === 'right').map((c) => c.y + c.h)
  );
  const overflow = Math.round(sideBottom - columnBottom);
  let bottom = Math.max(columnBottom, ...callouts.map((c) => c.y + c.h));
  if (on('bottom').length > 0) {
    const y = bottom + STUB + 16;
    bottom =
      y + placeRow(on('bottom'), 'bottom', MARGIN, CANVAS_WIDTH - 2 * MARGIN, y, ROW_MAX_WIDTH);
  }

  // What is bound but has no place on the drawing: a list under it, never left out.
  const drawn = new Set(drawing.controls.flatMap((c) => c.inputs.map((i) => i.id)));
  const extras: Row[] = [];
  const quiet = (options.listed ?? [])
    .filter((id) => !byId.has(id))
    .map((id): SheetControl => ({ id, name: id, bindings: [], conflict: false }));
  for (const control of [...controls, ...quiet].sort((a, b) => compareControlIds(a.id, b.id))) {
    if (drawn.has(control.id)) continue;
    if (control.bindings.length === 0 && !control.note && options.listed?.includes(control.id)) {
      extras.push({
        id: control.id,
        tag: controlShort(control.id),
        text: `${controlShort(control.id)} —`,
        lines: [],
        dim: true,
      });
      continue;
    }
    for (const binding of control.bindings) {
      const bold = binding.modifiers.length > 0 ? `${binding.modifiers.join('+')}:` : undefined;
      extras.push({
        id: control.id,
        tag: controlShort(control.id),
        ...(bold ? { bold } : {}),
        text: [controlShort(control.id), bold, binding.short].filter(Boolean).join(' '),
        lines: [],
        kind: binding.kind,
        dim: binding.source === 'default',
      });
    }
    if (control.note) {
      extras.push({
        id: control.id,
        tag: controlShort(control.id),
        text: `${controlShort(control.id)} ✎ ${control.note}`,
        lines: [],
        dim: false,
        note: true,
      });
    }
  }
  let extrasBox: CalloutPlan['extrasBox'];
  if (extras.length > 0) {
    const columns = extras.length > 8 ? 3 : extras.length > 3 ? 2 : 1;
    const w = CANVAS_WIDTH - 2 * MARGIN;
    const colW = (w - (columns - 1) * GAP) / columns;
    const size = ROW_SIZE * scale;
    for (const row of extras) row.lines = wrapText(row.text, colW - 2 * PAD - MARK - 6, size);
    const perColumn = Math.ceil(extras.length / columns);
    let tallest = 0;
    for (let c = 0; c < columns; c++) {
      const slice = extras.slice(c * perColumn, (c + 1) * perColumn);
      const h = slice.reduce((sum, row) => sum + row.lines.length * size * LINE_HEIGHT + 2, 0);
      tallest = Math.max(tallest, h);
    }
    const y = bottom + 16;
    const h = PAD + HEAD_SIZE * scale * LINE_HEIGHT + 3 + tallest + PAD;
    extrasBox = { x: MARGIN, y, w, h: Math.round(h * 10) / 10, columns };
    bottom = y + extrasBox.h;
  }

  return {
    width: CANVAS_WIDTH,
    height: Math.round((bottom + MARGIN) * 10) / 10,
    placed,
    callouts,
    extras,
    ...(extrasBox ? { extrasBox } : {}),
    overflow,
  };
}

/** What a device says it has, for the list of a device with no drawing. */
export interface ReportedShape {
  buttons: number;
  axes: string[];
  hats: number;
}

/** Buttons per block in the list of a device with no drawing. */
const LIST_RUN = 8;

/** A block of the list: a made-up physical control with no place on any drawing. */
function listControl(
  id: string,
  name: string,
  inputs: { id: string; tag?: string }[]
): PhysicalControl {
  return {
    id,
    name,
    glyph: 'none',
    at: { x: 0, y: 0 },
    inputs: inputs.map((input) => ({ id: input.id, ...(input.tag ? { tag: input.tag } : {}) })),
    hidden: false,
    assumed: false,
  };
}

/**
 * The labels of a device RigReady has no drawing of: no picture to point into, so one
 * block per group of controls (the axes, each hat, buttons in runs of eight), packed into
 * two columns. Every input that does something is on it; with `showEmpty`, the free ones
 * too, and a run of buttons with nothing on any of them is one line.
 */
export function planList(
  controls: SheetControl[],
  reports: ReportedShape | undefined,
  options: PlanOptions = {}
): CalloutPlan {
  const showEmpty = options.showEmpty ?? false;
  const scale = options.fontScale ?? 1;
  const byId = new Map(controls.map((c) => [c.id, c]));
  const used = (id: string): boolean =>
    (byId.get(id)?.bindings.length ?? 0) > 0 || Boolean(byId.get(id)?.note);

  const axes = new Set(reports?.axes.map((a) => `axis:${a}`) ?? []);
  let hats = reports?.hats ?? 0;
  let buttons = reports?.buttons ?? 0;
  for (const control of controls) {
    const [kind, a] = control.id.split(':');
    if (kind === 'axis') axes.add(control.id);
    if (kind === 'hat') hats = Math.max(hats, Number(a));
    if (kind === 'button') buttons = Math.max(buttons, Number(a));
  }

  const groups: PhysicalControl[] = [];
  const axisIds = [...axes].sort(compareControlIds);
  if (axisIds.length > 0) {
    groups.push(
      listControl(
        'axes',
        'Axes',
        axisIds.map((id) => ({ id, tag: controlShort(id) }))
      )
    );
  }
  for (let hat = 1; hat <= hats; hat++) {
    groups.push(
      listControl(
        `hat-${hat}`,
        `Hat ${hat}`,
        HAT_DIRECTIONS.map((d) => ({ id: `hat:${hat}:${d}`, tag: HAT_ARROWS[d] }))
      )
    );
  }
  const idle: number[] = [];
  const flushIdle = (): void => {
    if (idle.length === 0) return;
    const first = idle[0]!;
    const last = idle[idle.length - 1]!;
    const name = first === last ? `Button ${first}` : `Buttons ${first}–${last}`;
    if (showEmpty) groups.push(listControl(`buttons-${first}`, name, []));
    idle.length = 0;
  };
  for (let first = 1; first <= buttons; first += LIST_RUN) {
    const ids: number[] = [];
    for (let n = first; n < first + LIST_RUN && n <= buttons; n++) ids.push(n);
    if (!ids.some((n) => used(`button:${n}`))) {
      idle.push(...ids);
      continue;
    }
    flushIdle();
    const last = ids[ids.length - 1]!;
    groups.push(
      listControl(
        `buttons-${first}`,
        first === last ? `Button ${first}` : `Buttons ${first}–${last}`,
        ids.map((n) => ({ id: `button:${n}`, tag: String(n) }))
      )
    );
  }
  flushIdle();

  const columns = 2;
  const w = (CANVAS_WIDTH - 2 * MARGIN - (columns - 1) * GAP) / columns;
  const heights = new Array<number>(columns).fill(MARGIN);
  const callouts: Callout[] = [];
  for (const control of groups) {
    let rows = rowsFor(control, byId, showEmpty);
    if (control.inputs.length === 0) {
      rows = [{ id: '', text: 'nothing bound', lines: [], dim: true }];
    }
    if (rows.length === 0) continue;
    const callout: Callout = {
      control,
      side: 'left',
      x: 0,
      y: 0,
      w,
      h: 0,
      head: control.name,
      rows,
      size: ROW_SIZE * scale,
      anchor: { x: 0, y: 0 },
      leader: [],
      empty: !rows.some((row) => !row.dim || row.note),
    };
    measure(callout, scale);
    // Into the shortest column, so the two end about level.
    const column = heights.indexOf(Math.min(...heights));
    callout.x = MARGIN + column * (w + GAP);
    callout.y = heights[column]!;
    heights[column] = callout.y + callout.h + GAP;
    callouts.push(callout);
  }
  const bottom = Math.max(...heights) - GAP;
  return {
    width: CANVAS_WIDTH,
    height: Math.round((Math.max(bottom, MARGIN + 40) + MARGIN) * 10) / 10,
    callouts,
    extras: [],
    overflow: 0,
  };
}

export const LAYOUT_METRICS = { MARGIN, GAP, PAD, HEAD_SIZE, ROW_SIZE, LINE_HEIGHT, STUB } as const;
