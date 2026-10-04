import { CATEGORIES, type CategoryId, type CategoryPattern } from './categories';
import {
  controlName,
  controlShort,
  HAT_ARROWS,
  type CrossControl,
  type CrossPosition,
  type DeviceLayout,
  type LayoutShape,
  type SingleControl,
} from './layout';
import type { SheetControl, SheetDevice } from './sheet';

/**
 * Draws a device's sheet as one SVG: the drawing of the device, a label card per control
 * with what it does, lines from cards to where the control is. Pure text in, text out,
 * with no script in the result, so the same picture is shown in the app, printed to PDF
 * and rendered to kneeboard PNGs.
 *
 * Every control carries `data-control="<id>"` so the page can light it up when the real
 * control is pressed, and every layout item `data-item` / `data-group` for the editor.
 */

export type ThemeName = 'dark' | 'light' | 'night';

export interface Theme {
  name: ThemeName;
  bg: string;
  body: string;
  bodyStroke: string;
  panel: string;
  screen: string;
  line: string;
  card: string;
  cardStroke: string;
  emptyStroke: string;
  text: string;
  muted: string;
  accent: string;
  accentFill: string;
  warn: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    bg: '#12171d',
    body: '#19212a',
    bodyStroke: '#313c49',
    panel: '#27313d',
    screen: '#0c1116',
    line: '#4a5868',
    card: '#222b35',
    cardStroke: '#3a4756',
    emptyStroke: '#2b3540',
    text: '#e9edf1',
    muted: '#93a0af',
    accent: '#5aa9e6',
    accentFill: '#1d3a52',
    warn: '#e2b23c',
  },
  light: {
    name: 'light',
    bg: '#ffffff',
    body: '#eef1f5',
    bodyStroke: '#b9c2cd',
    panel: '#dde3ea',
    screen: '#e4ebf2',
    line: '#8f9aa7',
    card: '#ffffff',
    cardStroke: '#9aa6b3',
    emptyStroke: '#c9d0d9',
    text: '#12171d',
    muted: '#566170',
    accent: '#1b6cb3',
    accentFill: '#d9ebfa',
    warn: '#a86a00',
  },
  // For a dark cockpit: black, dim reds, nothing blue or white.
  night: {
    name: 'night',
    bg: '#000000',
    body: '#0f0302',
    bodyStroke: '#4d1611',
    panel: '#1b0605',
    screen: '#070101',
    line: '#5e1c16',
    card: '#140403',
    cardStroke: '#5a1a14',
    emptyStroke: '#2d0c09',
    text: '#f0503f',
    muted: '#9a342a',
    accent: '#ff8a5c',
    accentFill: '#3a0d08',
    warn: '#ffae42',
  },
};

export interface RenderOptions {
  theme: ThemeName;
  /** Draw cards for controls nothing is bound to (as empty, dashed). Default true. */
  showEmpty?: boolean;
  /** Makes label text larger or smaller. Default 1. */
  fontScale?: number;
  /** The layout editor: every position of a cross is drawn, pins get handles. */
  edit?: boolean;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const n = (value: number): string => String(Math.round(value * 100) / 100);

export function categoryColor(kind: CategoryId, theme: ThemeName): string {
  return theme === 'night' ? CATEGORIES[kind].night : CATEGORIES[kind].color;
}

/** How a kind's marker is drawn: always solid, except in the night style (see categories.ts). */
export function categoryPattern(kind: CategoryId, theme: ThemeName): CategoryPattern {
  return theme === 'night' ? CATEGORIES[kind].nightPattern : 'solid';
}

/** The CSS `background` of a kind's legend swatch: a solid square, or a striped one. */
export function categorySwatch(kind: CategoryId, theme: ThemeName): string {
  const color = categoryColor(kind, theme);
  return categoryPattern(kind, theme) === 'dashed'
    ? `repeating-linear-gradient(0deg,${color} 0 3px,transparent 3px 5px)`
    : color;
}

/** The style sheet of a sheet picture. Scoped to .cs-svg, safe to inline in a page. */
export function sheetCss(theme: Theme): string {
  const t = theme;
  return `
.cs-svg{font-family:"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif;display:block}
.cs-svg .cs-bg{fill:${t.bg}}
.cs-svg .cs-s-body{fill:${t.body};stroke:${t.bodyStroke};stroke-width:1.5}
.cs-svg .cs-s-panel{fill:${t.panel};stroke:${t.bodyStroke};stroke-width:1}
.cs-svg .cs-s-screen{fill:${t.screen};stroke:${t.bodyStroke};stroke-width:1.5}
.cs-svg .cs-s-line{fill:none;stroke:${t.line};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.cs-svg .cs-s-accent{fill:none;stroke:${t.accent};stroke-width:2}
.cs-svg text.cs-s-body,.cs-svg text.cs-s-panel,.cs-svg text.cs-s-screen,.cs-svg text.cs-s-line{fill:${t.muted};stroke:none;font-weight:600;letter-spacing:.04em}
.cs-svg text.cs-s-accent{fill:${t.accent};stroke:none;font-weight:600}
.cs-svg .cs-group{fill:none;stroke:${t.line};stroke-width:1;stroke-dasharray:none;opacity:.75}
.cs-svg .cs-group-label{fill:${t.muted};font-size:11.5px;font-weight:700;letter-spacing:.07em}
.cs-svg .cs-card{fill:${t.card};stroke:${t.cardStroke};stroke-width:1}
.cs-svg .cs-empty .cs-card{fill:none;stroke:${t.emptyStroke};stroke-dasharray:4 3}
.cs-svg .cs-empty .cs-num{opacity:.75}
.cs-svg .cs-conflict .cs-card{stroke:${t.warn};stroke-width:1.6}
.cs-svg .cs-lead{stroke:${t.line};stroke-width:1.2;fill:none}
.cs-svg .cs-pin{stroke:${t.bg};stroke-width:1.5}
.cs-svg .cs-track{fill:${t.emptyStroke}}
.cs-svg .cs-axis-val{fill:${t.accent};opacity:0}
.cs-svg .cs-live .cs-axis-val{opacity:1}
.cs-svg .cs-hub{fill:${t.panel};stroke:${t.bodyStroke};stroke-width:1.2}
.cs-svg .cs-hub-text{fill:${t.muted};font-size:10.5px;font-weight:700;letter-spacing:.05em}
.cs-svg .cs-t{color:${t.text};line-height:${LINE_HEIGHT};overflow:hidden;height:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal}
.cs-svg .cs-head{display:flex;align-items:baseline;gap:4px;color:${t.muted};font-size:.82em;font-weight:600;white-space:nowrap;overflow:hidden}
.cs-svg .cs-num{font-weight:800;color:${t.text};font-variant-numeric:tabular-nums}
.cs-svg .cs-phys{overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}
.cs-svg .cs-flag{margin-left:auto;font-weight:800}
.cs-svg .cs-flag-warn{color:${t.warn}}
.cs-svg .cs-act{font-weight:600}
.cs-svg .cs-default{color:${t.muted};font-weight:500}
.cs-svg .cs-mod{font-weight:500}
.cs-svg .cs-mod b{color:${t.accent};font-weight:700}
.cs-svg .cs-note{color:${t.accent};font-style:italic;font-weight:500}
.cs-svg .cs-ctl{transition:opacity .12s}
.cs-svg .cs-ctl.cs-dim{opacity:.22}
.cs-svg .cs-ctl.cs-on .cs-card{fill:${t.accentFill};stroke:${t.accent};stroke-width:2.6;stroke-dasharray:none}
.cs-svg .cs-ctl.cs-sel .cs-card{stroke:${t.accent};stroke-width:2;stroke-dasharray:none}
.cs-svg .cs-ctl.cs-hit .cs-card{stroke:${t.accent};stroke-width:1.8;stroke-dasharray:none}
.cs-svg.cs-click .cs-ctl{cursor:pointer}
.cs-svg .cs-handle{fill:${t.accent};stroke:${t.bg};stroke-width:1.5;cursor:nwse-resize}
.cs-svg .cs-pin-handle{fill:${t.bg};stroke:${t.accent};stroke-width:2;cursor:move}
.cs-svg.cs-editing .cs-ctl,.cs-svg.cs-editing .cs-group-hit{cursor:move}
.cs-svg .cs-group-hit{fill:transparent;stroke:none}
.cs-svg .cs-group.cs-sel{stroke:${t.accent};stroke-width:2;opacity:1}
`;
}

interface CardText {
  short: string;
  physical?: string;
  control?: SheetControl;
}

/** Line height of card text, in em. The estimate below and the style sheet share it. */
const LINE_HEIGHT = 1.16;
/** The head row (control number, printed label) is this much smaller than the text. */
const HEAD_SCALE = 0.82;
/**
 * Label sizes tried from the largest. The last one is the smallest that is still read
 * with ease on a printed page and on a kneeboard: text that does not fit at it is
 * shortened, not made smaller.
 */
const FONT_SIZES = [14, 13, 12, 11, 10.2];
/** Only for a card so small that not one row fits at the smallest label size. */
const TINY_CARD_SIZES = [9.4, 8.6, 7.8, 7];

/**
 * How wide each character from space to tilde is in Segoe UI Semibold, in thousandths of
 * an em: the font's own advance widths. That is the face label text is drawn in (the
 * style sheet asks for Segoe UI first, and weight 600), so text can be measured here
 * exactly, with no browser to ask: a page made for the Render port runs no script.
 */
const ASCII_WIDTHS = [
  275, 304, 438, 591, 555, 840, 715, 258, 332, 332, 434, 694, 241, 402, 241, 414, 555, 402, 555,
  555, 576, 555, 558, 536, 555, 558, 241, 241, 694, 694, 694, 444, 955, 671, 604, 621, 717, 518,
  502, 697, 735, 292, 397, 611, 489, 924, 767, 756, 585, 756, 623, 544, 552, 703, 642, 966, 619,
  577, 587, 332, 405, 332, 694, 415, 289, 522, 603, 470, 603, 531, 345, 603, 582, 261, 261, 525,
  261, 886, 584, 597, 603, 603, 370, 431, 361, 584, 507, 756, 501, 508, 464, 332, 278, 332, 694,
];
/** The same for the few other characters labels use; the pencil comes from the symbol font. */
const OTHER_WIDTHS: Record<string, number> = {
  '…': 814,
  '✎': 1000,
  '◄': 861,
  '►': 861,
  '▲': 861,
  '▼': 861,
  '↑': 472,
  '↓': 472,
  '←': 863,
  '→': 863,
  '↔': 862,
  '⟷': 1400,
  '·': 241,
  '–': 500,
  '—': 1000,
  '×': 694,
  '’': 256,
};
/**
 * Air on top of the font's own widths. A line may be drawn a little wider than they add
 * up to: the modifier in front of an action is bold, and small sizes are hinted. An
 * estimate that errs must err towards smaller text, never towards text that does not fit.
 */
const MEASURE_MARGIN = 1.03;

/** How wide a character is, in em. */
function charWidth(ch: string): number {
  const code = ch.charCodeAt(0);
  const known = code >= 32 && code <= 126 ? ASCII_WIDTHS[code - 32] : OTHER_WIDTHS[ch];
  if (known !== undefined) return (known / 1000) * MEASURE_MARGIN;
  // Accented letters are as wide as their base letter at most; symbols, arrows and
  // letters of other scripts are about as wide as they are tall.
  return code > 0x2000 ? 1.05 : 0.72;
}

/** The width of a run of text at a font size, in the units the size is in. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return em * size;
}

/**
 * How many rows a line takes in a box this wide, the way the browser lays it out: it
 * wraps at spaces, and a word that is wider than the box starts on a row of its own and
 * is broken between any two characters, over as many rows as it needs (the style sheet
 * asks for that, so a long word never sticks out). The browser may also break after a
 * hyphen or a slash, which can only save a row: counting without it never counts too few.
 */
export function wrappedRows(line: string, width: number, size: number): number {
  const space = textWidth(' ', size);
  let rows = 1;
  let used = 0;
  for (const word of line.split(/\s+/).filter(Boolean)) {
    const w = textWidth(word, size);
    if (w <= width) {
      if (used === 0) {
        used = w;
      } else if (used + space + w <= width) {
        used += space + w;
      } else {
        rows++;
        used = w;
      }
      continue;
    }
    if (used > 0) rows++;
    used = 0;
    for (const ch of word) {
      const wide = charWidth(ch) * size;
      if (used > 0 && used + wide > width) {
        rows++;
        used = 0;
      }
      used += wide;
    }
  }
  return rows;
}

export interface FittedText {
  /** Font size in px. */
  size: number;
  /** The lines that are shown: all of them, or fewer with the last one cut short. */
  lines: string[];
  /** True when text had to be cut ("…"); the full text is in the control's tooltip and lists. */
  shortened: boolean;
}

/**
 * Fits the lines of a label card into its box. The size steps down while that helps:
 * the largest size at which everything fits is used. Text that does not fit even at the
 * smallest label size is too long for the card, and is shown at that size as the whole
 * rows there is room for, ending in an ellipsis. Nothing is ever left to be clipped by
 * the box, and nothing is made too small to read to avoid saying so.
 */
export function fitText(
  lines: string[],
  width: number,
  height: number,
  scale = 1,
  /** Whether the box also holds the head row (the control's number and printed label). */
  head = false
): FittedText {
  const sizeOf = (base: number): number => Math.round(base * scale * 10) / 10;
  if (lines.length === 0) return { size: sizeOf(FONT_SIZES[0]!), lines, shortened: false };
  const wide = Math.max(1, width);
  /** How many whole rows of text the box holds at a size. */
  const room = (size: number): number =>
    Math.floor((height - (head ? size * HEAD_SCALE * LINE_HEIGHT : 0) - 1) / (size * LINE_HEIGHT));
  const needs = (size: number): number =>
    lines.reduce((rows, line) => rows + wrappedRows(line, wide, size), 0);

  let size = sizeOf(FONT_SIZES[0]!);
  for (const base of FONT_SIZES) {
    size = sizeOf(base);
    if (needs(size) <= room(size)) return { size, lines, shortened: false };
  }
  // A card that cannot hold one row at that size gets smaller type, until one row fits.
  for (const base of TINY_CARD_SIZES) {
    if (room(size) >= 1) break;
    size = sizeOf(base);
    if (needs(size) <= room(size)) return { size, lines, shortened: false };
  }

  // Too long for the card: the rows there is room for, and an ellipsis.
  const maxRows = Math.max(1, room(size));
  const kept: string[] = [];
  let used = 0;
  let shortened = false;
  for (const line of lines) {
    const rows = wrappedRows(line, wide, size);
    if (used + rows <= maxRows) {
      kept.push(line);
      used += rows;
      continue;
    }
    if (used < maxRows) {
      kept.push(cutToRows(line, maxRows - used, wide, size));
    } else {
      // No row left for this line: the one before says that there is more.
      const last = kept.length - 1;
      kept[last] = cutToRows(kept[last]!, wrappedRows(kept[last]!, wide, size), wide, size);
    }
    shortened = true;
    break;
  }
  return { size, lines: kept, shortened };
}

/**
 * As much of a line as fits in so many rows with an ellipsis after it. The cut is made
 * between words where that loses little, so a label does not end in half a word.
 */
function cutToRows(line: string, rows: number, width: number, size: number): string {
  const whole = line.trim();
  let text = whole;
  while (text.length > 1 && wrappedRows(`${text}…`, width, size) > rows) {
    text = text.slice(0, -1).trimEnd();
  }
  const midWord = text.length < whole.length && whole[text.length] !== ' ';
  const word = text.lastIndexOf(' ');
  if (midWord && word >= text.length * 0.6) text = text.slice(0, word).trimEnd();
  // "Knob:…" reads better as "Knob…".
  const tidy = text.replace(/[\s:;,./(-]+$/, '');
  return `${tidy || text}…`;
}

/**
 * The largest font size at which the lines fit a box (the size part of fitText, for a
 * box without a head row).
 */
export function fitFont(lines: string[], width: number, height: number, scale = 1): number {
  return fitText(lines, width, height, scale).size;
}

function cardBody(card: CardText, w: number, h: number, options: RenderOptions): string {
  const control = card.control;
  const bindings = control?.bindings ?? [];
  const also = bindings.some((b) => b.alsoOn.length > 0);
  const flags =
    (control?.conflict
      ? `<span class="cs-flag cs-flag-warn" title="Fires together">!</span>`
      : '') +
    (also && !control?.conflict
      ? `<span class="cs-flag" title="Also on another control">×2</span>`
      : '');
  const head =
    `<div class="cs-head"><span class="cs-num">${escapeHtml(card.short)}</span>` +
    (card.physical ? `<span class="cs-phys">${escapeHtml(card.physical)}</span>` : '') +
    `${flags}</div>`;
  // What each line says, and how it is dressed.
  const entries: { text: string; cls: string; bold?: string }[] = [];
  for (const binding of bindings) {
    const dim = binding.source === 'default' ? ' cs-default' : '';
    if (binding.modifiers.length > 0) {
      const bold = `${binding.modifiers.join('+')}:`;
      entries.push({ text: `${bold} ${binding.short}`, cls: `cs-mod${dim}`, bold });
    } else {
      entries.push({ text: binding.short, cls: `cs-act${dim}` });
    }
  }
  if (control?.note) entries.push({ text: `✎ ${control.note}`, cls: 'cs-note' });
  // The text box is the foreignObject below, less a little air on the right.
  const fitted = fitText(
    entries.map((e) => e.text),
    w - 13,
    h - 4,
    options.fontScale ?? 1,
    true
  );
  const body = fitted.lines.map((text, i) => {
    const entry = entries[i]!;
    const bold = entry.bold && text.startsWith(`${entry.bold} `) ? entry.bold : undefined;
    return bold
      ? `<div class="${entry.cls}"><b>${escapeHtml(bold)}</b>${escapeHtml(text.slice(bold.length))}</div>`
      : `<div class="${entry.cls}">${escapeHtml(text)}</div>`;
  });
  return (
    `<foreignObject x="7" y="2" width="${n(w - 10)}" height="${n(h - 4)}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="cs-t"${fitted.shortened ? ' data-shortened="true"' : ''} style="font-size:${fitted.size}px">${head}${body.join('')}</div>` +
    `</foreignObject>`
  );
}

function titleOf(id: string, control: SheetControl | undefined, physical?: string): string {
  const head = physical ? `${controlName(id)} (${physical})` : controlName(id);
  if (!control || (control.bindings.length === 0 && !control.note)) return `${head}: nothing bound`;
  const what = control.bindings
    .map(
      (b) =>
        (b.modifiers.length ? `${b.modifiers.join('+')}: ` : '') +
        (b.plain ? `${b.plain} (${b.action})` : b.action)
    )
    .join(' / ');
  return `${head}: ${what}${control.note ? ` (${control.note})` : ''}`;
}

function card(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  physical: string | undefined,
  control: SheetControl | undefined,
  options: RenderOptions,
  axis = false
): string {
  const bound = (control?.bindings.length ?? 0) > 0;
  const filled = bound || Boolean(control?.note);
  if (!filled && options.showEmpty === false && !options.edit) return '';
  const kind = control?.bindings[0]?.kind;
  const classes = ['cs-ctl', filled ? 'cs-bound' : 'cs-empty'];
  if (control?.conflict) classes.push('cs-conflict');
  const stripe = kind ? stripeMark(kind, h, options.theme) : '';
  const track = axis
    ? `<rect class="cs-track" x="8" y="${n(h - 6.5)}" width="${n(w - 16)}" height="3" rx="1.5"/>` +
      `<rect class="cs-axis-val" data-axis="${id}" data-x0="8" data-w="${n(w - 16)}" x="${n(w / 2 - 2)}" y="${n(h - 9)}" width="4" height="8" rx="2"/>`
    : '';
  const head = axis ? `${controlShort(id)} ⟷` : controlShort(id);
  return (
    `<g class="${classes.join(' ')}" data-control="${id}"${kind ? ` data-kind="${kind}"` : ''} transform="translate(${n(x)} ${n(y)})">` +
    `<title>${escapeHtml(titleOf(id, control, physical))}</title>` +
    `<rect class="cs-card" width="${n(w)}" height="${n(h)}" rx="6"/>${stripe}` +
    cardBody(
      { short: head, ...(physical ? { physical } : {}), ...(control ? { control } : {}) },
      w,
      axis ? h - 6 : h,
      options
    ) +
    track +
    `</g>`
  );
}

/** The bar on the left edge of a card that says what kind of action it is. */
function stripeMark(kind: CategoryId, h: number, theme: ThemeName): string {
  const color = categoryColor(kind, theme);
  if (categoryPattern(kind, theme) === 'dashed') {
    return `<line class="cs-stripe" data-pattern="dashed" x1="2.25" y1="2.5" x2="2.25" y2="${n(h - 2.5)}" stroke="${color}" stroke-width="4.5" stroke-dasharray="5 3.5"/>`;
  }
  return `<rect class="cs-stripe" data-pattern="solid" x="0" y="0" width="4.5" height="${n(h)}" rx="2" fill="${color}"/>`;
}

/** Where a line from a pin meets the card: the nearest point on its edge. */
function edgePoint(
  box: { x: number; y: number; w: number; h: number },
  pin: { x: number; y: number }
): { x: number; y: number } {
  const x = Math.max(box.x, Math.min(box.x + box.w, pin.x));
  const y = Math.max(box.y, Math.min(box.y + box.h, pin.y));
  return { x, y };
}

function pinMarks(
  box: { x: number; y: number; w: number; h: number; pin?: { x: number; y: number } | undefined },
  color: string,
  index: number,
  options: RenderOptions,
  /** A ring instead of a dot: the pin of a kind whose marker is dashed. */
  hollow = false
): string {
  if (!box.pin) return '';
  const end = edgePoint(box, box.pin);
  return (
    `<line class="cs-lead" x1="${n(box.pin.x)}" y1="${n(box.pin.y)}" x2="${n(end.x)}" y2="${n(end.y)}"/>` +
    (options.edit
      ? `<circle class="cs-pin-handle" data-pin="${index}" cx="${n(box.pin.x)}" cy="${n(box.pin.y)}" r="7"/>`
      : hollow
        ? `<circle class="cs-pin" cx="${n(box.pin.x)}" cy="${n(box.pin.y)}" r="4.5" style="fill:${THEMES[options.theme].bg};stroke:${color};stroke-width:2.5"/>`
        : `<circle class="cs-pin" cx="${n(box.pin.x)}" cy="${n(box.pin.y)}" r="5" fill="${color}"/>`)
  );
}

const CROSS_CELL: Record<CrossPosition, [number, number]> = {
  UL: [0, 0],
  U: [1, 0],
  UR: [2, 0],
  L: [0, 1],
  C: [1, 1],
  R: [2, 1],
  DL: [0, 2],
  D: [1, 2],
  DR: [2, 2],
};

function cross(
  control: CrossControl,
  byId: Map<string, SheetControl>,
  options: RenderOptions
): string {
  const gap = 4;
  const cw = (control.w - 2 * gap) / 3;
  const ch = (control.h - 2 * gap) / 3;
  const out: string[] = [];
  const does = (id: string): boolean =>
    (byId.get(id)?.bindings.length ?? 0) > 0 || Boolean(byId.get(id)?.note);
  // With empty controls hidden, a switch nothing is bound to is left out as a whole.
  if (options.showEmpty === false && !options.edit && !Object.values(control.inputs).some(does)) {
    return '';
  }
  for (const [position, id] of Object.entries(control.inputs) as [CrossPosition, string][]) {
    const [col, row] = CROSS_CELL[position];
    const entry = byId.get(id);
    const diagonal = position.length === 2;
    const filled = does(id);
    // Diagonals of a hat are mostly unused; they only take room when they do something.
    if (diagonal && !filled && !options.edit) continue;
    out.push(
      card(
        id,
        control.x + col * (cw + gap),
        control.y + row * (ch + gap),
        cw,
        ch,
        // A hat direction already says which way it is ("H1↑"); a button gets the arrow.
        id.startsWith('hat:') ? undefined : HAT_ARROWS[position],
        entry,
        { ...options, showEmpty: true }
      )
    );
  }
  if (!control.inputs.C) {
    const cx = control.x + control.w / 2;
    const cy = control.y + control.h / 2;
    const r = Math.min(cw, ch) / 2 - 3;
    const words = (control.label ?? '').split(' ');
    const first = words.slice(0, Math.ceil(words.length / 2)).join(' ');
    const second = words.slice(Math.ceil(words.length / 2)).join(' ');
    out.push(
      `<circle class="cs-hub" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>` +
        `<text class="cs-hub-text" text-anchor="middle" x="${n(cx)}" y="${n(second ? cy - 2 : cy + 4)}">${escapeHtml(first)}</text>` +
        (second
          ? `<text class="cs-hub-text" text-anchor="middle" x="${n(cx)}" y="${n(cy + 11)}">${escapeHtml(second)}</text>`
          : '')
    );
  } else if (control.label) {
    out.push(
      `<text class="cs-hub-text" x="${n(control.x)}" y="${n(control.y + 11)}">${escapeHtml(control.label)}</text>`
    );
  }
  return out.join('');
}

function shape(item: LayoutShape): string {
  const cls = `cs-s-${item.role}`;
  switch (item.type) {
    case 'rect':
      return `<rect class="${cls}" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.w)}" height="${n(item.h)}" rx="${n(item.r)}"/>`;
    case 'ellipse':
      return `<ellipse class="${cls}" cx="${n(item.cx)}" cy="${n(item.cy)}" rx="${n(item.rx)}" ry="${n(item.ry)}"/>`;
    case 'line': {
      const points: string[] = [];
      for (let i = 0; i + 1 < item.points.length; i += 2) {
        points.push(`${n(item.points[i]!)},${n(item.points[i + 1]!)}`);
      }
      return item.closed
        ? `<polygon class="${cls}" points="${points.join(' ')}"/>`
        : `<polyline class="${cls}" points="${points.join(' ')}"/>`;
    }
    case 'text':
      return `<text class="${cls}" text-anchor="middle" x="${n(item.x)}" y="${n(item.y)}" font-size="${n(item.size)}">${escapeHtml(item.text)}</text>`;
  }
}

/** The picture of one device with its labels, as SVG markup. */
export function renderDeviceSvg(
  device: Pick<SheetDevice, 'layout' | 'controls'>,
  options: RenderOptions
): string {
  const theme = THEMES[options.theme];
  const layout: DeviceLayout = device.layout;
  const byId = new Map(device.controls.map((c) => [c.id, c]));
  const { width, height } = layout.canvas;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="cs-svg${options.edit ? ' cs-editing' : ''}" data-theme="${theme.name}" viewBox="0 0 ${n(width)} ${n(height)}" preserveAspectRatio="xMidYMin meet">`
  );
  out.push(`<style>${sheetCss(theme)}</style>`);
  out.push(`<rect class="cs-bg" x="0" y="0" width="${n(width)}" height="${n(height)}"/>`);
  if (layout.background) {
    const b = layout.background;
    out.push(
      `<image href="${b.image}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" opacity="${n(b.opacity)}" preserveAspectRatio="none"/>`
    );
  }
  for (const item of layout.shapes) out.push(shape(item));
  const does = (id: string): boolean =>
    (byId.get(id)?.bindings.length ?? 0) > 0 || Boolean(byId.get(id)?.note);
  layout.groups.forEach((group, index) => {
    // With empty controls hidden, a frame with nothing left in it is not drawn either.
    if (options.showEmpty === false && !options.edit) {
      const inside = layout.controls.some((control) => {
        const cx = control.x + control.w / 2;
        const cy = control.y + control.h / 2;
        if (cx < group.x || cx > group.x + group.w || cy < group.y || cy > group.y + group.h) {
          return false;
        }
        return control.kind === 'cross'
          ? Object.values(control.inputs).some(does)
          : does(control.input);
      });
      if (!inside) return;
    }
    out.push(
      `<g data-group="${index}">` +
        `<rect class="cs-group" x="${n(group.x)}" y="${n(group.y)}" width="${n(group.w)}" height="${n(group.h)}" rx="9"/>` +
        (options.edit
          ? `<rect class="cs-group-hit" x="${n(group.x)}" y="${n(group.y)}" width="${n(group.w)}" height="20"/>`
          : '') +
        `<text class="cs-group-label" x="${n(group.x + 9)}" y="${n(group.y + 15.5)}">${escapeHtml(group.label)}</text>` +
        `</g>`
    );
  });
  // Lines first, so cards sit on top of them.
  layout.controls.forEach((control, index) => {
    const kind = control.kind === 'cross' ? undefined : byId.get(control.input)?.bindings[0]?.kind;
    const visible =
      control.kind === 'cross' ||
      options.edit ||
      options.showEmpty !== false ||
      (byId.get(control.input)?.bindings.length ?? 0) > 0 ||
      Boolean(byId.get(control.input)?.note);
    if (!visible) return;
    out.push(
      pinMarks(
        control,
        kind ? categoryColor(kind, options.theme) : theme.line,
        index,
        options,
        kind !== undefined && categoryPattern(kind, options.theme) === 'dashed'
      )
    );
  });
  layout.controls.forEach((control, index) => {
    const body =
      control.kind === 'cross' ? cross(control, byId, options) : single(control, byId, options);
    if (!body) return;
    out.push(`<g data-item="${index}">${body}</g>`);
    if (options.edit) {
      out.push(
        `<rect class="cs-handle" data-resize="${index}" x="${n(control.x + control.w - 6)}" y="${n(control.y + control.h - 6)}" width="10" height="10" rx="2"/>`
      );
    }
  });
  out.push('</svg>');
  return out.join('');
}

function single(
  control: SingleControl,
  byId: Map<string, SheetControl>,
  options: RenderOptions
): string {
  return card(
    control.input,
    control.x,
    control.y,
    control.w,
    control.h,
    control.label,
    byId.get(control.input),
    options,
    control.kind === 'axis'
  );
}
