import { CATEGORIES, type CategoryId } from './categories';
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
.cs-svg .cs-t{color:${t.text};line-height:1.16;overflow:hidden;height:100%;box-sizing:border-box;word-break:break-word}
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

/**
 * The largest font size at which the card's text fits its box, from a rough measure of
 * the text (no browser to ask). Below the smallest size the text is clipped.
 */
export function fitFont(lines: string[], width: number, height: number, scale = 1): number {
  const sizes = [14, 13, 12, 11, 10.2, 9.4, 8.6];
  for (const base of sizes) {
    const size = base * scale;
    // Semi-bold text in a UI font is a little over half as wide as it is tall, on average.
    const perLine = Math.max(4, Math.floor(width / (size * 0.56)));
    let rows = 0;
    for (const line of lines) rows += wrappedRows(line, perLine);
    if (rows * size * 1.16 <= height) return Math.round(size * 10) / 10;
  }
  return Math.round(sizes[sizes.length - 1]! * scale * 10) / 10;
}

/** How many rows a line takes when it wraps at spaces (and inside a word that is too long). */
function wrappedRows(line: string, perLine: number): number {
  let rows = 1;
  let used = 0;
  for (const word of line.split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) {
      // A long word starts on a row of its own and runs over as many as it needs.
      if (used > 0) rows++;
      rows += Math.ceil(word.length / perLine) - 1;
      used = word.length % perLine || perLine;
    } else if (used === 0) {
      used = word.length;
    } else if (used + 1 + word.length <= perLine) {
      used += 1 + word.length;
    } else {
      rows++;
      used = word.length;
    }
  }
  return rows;
}

function cardBody(card: CardText, w: number, h: number, options: RenderOptions): string {
  const control = card.control;
  const bindings = control?.bindings ?? [];
  const lines: string[] = [];
  const parts: string[] = [];
  const also = bindings.some((b) => b.alsoOn.length > 0);
  const flags =
    (control?.conflict
      ? `<span class="cs-flag cs-flag-warn" title="Fires together">!</span>`
      : '') +
    (also && !control?.conflict
      ? `<span class="cs-flag" title="Also on another control">×2</span>`
      : '');
  parts.push(
    `<div class="cs-head"><span class="cs-num">${escapeHtml(card.short)}</span>` +
      (card.physical ? `<span class="cs-phys">${escapeHtml(card.physical)}</span>` : '') +
      `${flags}</div>`
  );
  for (const binding of bindings) {
    const modifiers = binding.modifiers.length > 0 ? `${binding.modifiers.join('+')}: ` : '';
    lines.push(modifiers + binding.short);
    const cls = binding.source === 'default' ? ' cs-default' : '';
    parts.push(
      binding.modifiers.length > 0
        ? `<div class="cs-mod${cls}"><b>${escapeHtml(binding.modifiers.join('+'))}:</b> ${escapeHtml(binding.short)}</div>`
        : `<div class="cs-act${cls}">${escapeHtml(binding.short)}</div>`
    );
  }
  if (control?.note) {
    lines.push(`✎ ${control.note}`);
    parts.push(`<div class="cs-note">✎ ${escapeHtml(control.note)}</div>`);
  }
  const headHeight = 12;
  const size = fitFont(lines, w - 13, h - 5 - headHeight, options.fontScale ?? 1);
  return (
    `<foreignObject x="7" y="2" width="${n(w - 10)}" height="${n(h - 4)}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="cs-t" style="font-size:${size}px">${parts.join('')}</div>` +
    `</foreignObject>`
  );
}

function titleOf(id: string, control: SheetControl | undefined, physical?: string): string {
  const head = physical ? `${controlName(id)} (${physical})` : controlName(id);
  if (!control || (control.bindings.length === 0 && !control.note)) return `${head}: nothing bound`;
  const what = control.bindings
    .map((b) => (b.modifiers.length ? `${b.modifiers.join('+')}: ` : '') + b.action)
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
  const stripe = kind
    ? `<rect class="cs-stripe" x="0" y="0" width="4.5" height="${n(h)}" rx="2" fill="${categoryColor(kind, options.theme)}"/>`
    : '';
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
  options: RenderOptions
): string {
  if (!box.pin) return '';
  const end = edgePoint(box, box.pin);
  return (
    `<line class="cs-lead" x1="${n(box.pin.x)}" y1="${n(box.pin.y)}" x2="${n(end.x)}" y2="${n(end.y)}"/>` +
    (options.edit
      ? `<circle class="cs-pin-handle" data-pin="${index}" cx="${n(box.pin.x)}" cy="${n(box.pin.y)}" r="7"/>`
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
      pinMarks(control, kind ? categoryColor(kind, options.theme) : theme.line, index, options)
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
