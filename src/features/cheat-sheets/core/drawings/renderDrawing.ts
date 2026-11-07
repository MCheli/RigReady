import type { CategoryId } from '../categories';
import { controlName } from '../layout';
import {
  categoryColor,
  categoryPattern,
  escapeHtml,
  sheetCss,
  THEMES,
  type Theme,
  type ThemeName,
} from '../render';
import type { SheetControl } from '../sheet';
import { LAYOUT_METRICS, MARK, type Callout, type CalloutPlan, type Row } from './callouts';
import type { DeviceDrawing, PhysicalControl } from './silhouette';

/**
 * Draws a callout plan as one SVG, in the same themes and with the same class names as
 * the card renderer (core/render.ts), so the page's live highlight (`.cs-ctl[data-control]`
 * gets `.cs-on`), the search and the night page's colours carry over. Pure text in, text
 * out, no script in the result: the same picture goes to the app, the PDF and the
 * kneeboard PNGs.
 */

export interface RenderDrawingOptions {
  theme: ThemeName;
  /** The editor: every anchor gets a handle to drag (`data-anchor-handle`). */
  edit?: boolean;
  /** A photo or drawing of the user's behind the controls, in place of the silhouette. */
  background?: { image: string; opacity: number } | undefined;
}

const n = (value: number): string => String(Math.round(value * 100) / 100);
const { PAD, HEAD_SIZE, LINE_HEIGHT } = LAYOUT_METRICS;

/** What the shipped style sheet does not have: the drawing's extra roles and the blocks. */
function extraCss(t: Theme): string {
  return `
.cs-svg .cs-s-shade{fill:${t.bodyStroke};fill-opacity:.35;stroke:none}
.cs-svg .cs-s-key{fill:${t.card};stroke:${t.bodyStroke};stroke-width:1.2}
.cs-svg .cs-s-dashed{stroke-dasharray:4 3}
.cs-svg .cs-glyph{fill:${t.panel};stroke:${t.line};stroke-width:1.6}
.cs-svg .cs-glyph-dot{fill:${t.line};stroke:none}
.cs-svg .cs-block{fill:${t.card};stroke:${t.cardStroke};stroke-width:1}
.cs-svg .cs-block-empty{fill:none;stroke:${t.emptyStroke};stroke-dasharray:4 3}
.cs-svg .cs-bhead{fill:${t.muted};font-size:${HEAD_SIZE}px;font-weight:700;letter-spacing:.06em}
.cs-svg .cs-anchor-handle{fill:transparent;stroke:${t.accent};stroke-width:2;stroke-dasharray:3 2;cursor:move}
.cs-svg .cs-callout.cs-picked .cs-block{stroke:${t.accent};stroke-width:2}
.cs-svg .cs-callout.cs-picked .cs-anchor-handle{stroke-dasharray:none;stroke-width:3}
.cs-svg.cs-editing .cs-callout{cursor:pointer}
.cs-svg .cs-row-text{fill:${t.text};font-weight:600}
.cs-svg .cs-row-text.cs-dim{fill:${t.muted};font-weight:500}
.cs-svg .cs-row-text.cs-note{fill:${t.accent};font-style:italic;font-weight:500}
.cs-svg .cs-row-text tspan.cs-tag{font-weight:700}
.cs-svg .cs-row-text tspan.cs-mod{fill:${t.accent};font-weight:700}
.cs-svg .cs-row{fill:transparent;stroke:none}
.cs-svg .cs-ctl.cs-on .cs-row{fill:${t.accentFill};stroke:${t.accent};stroke-width:1.6}
.cs-svg .cs-ctl.cs-sel .cs-row{stroke:${t.accent};stroke-width:1.2}
.cs-svg .cs-lead2{stroke:${t.line};stroke-width:1.4;fill:none;stroke-linejoin:round}
.cs-svg .cs-anchor{stroke:${t.bg};stroke-width:1.5}
.cs-svg text.cs-print{fill:${t.muted};font-weight:700;letter-spacing:.06em}
`;
}

function markSvg(x: number, y: number, kind: CategoryId | undefined, theme: ThemeName): string {
  if (!kind) return '';
  const color = categoryColor(kind, theme);
  if (categoryPattern(kind, theme) === 'dashed') {
    return `<rect x="${n(x + 1)}" y="${n(y + 1)}" width="${MARK - 2}" height="${MARK - 2}" rx="1.5" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
  return `<rect x="${n(x)}" y="${n(y)}" width="${MARK}" height="${MARK}" rx="2" fill="${color}"/>`;
}

/** One row of a block: the kind mark, the text with its tag in bold, a title for the tooltip. */
function rowSvg(
  row: Row,
  x: number,
  y: number,
  w: number,
  size: number,
  byId: Map<string, SheetControl>,
  theme: ThemeName,
  first: boolean
): { svg: string; h: number } {
  const h = row.lines.length * size * LINE_HEIGHT + 2;
  const classes = ['cs-ctl', row.dim && !row.note ? 'cs-empty' : 'cs-bound'];
  const textClass = ['cs-row-text', row.dim ? 'cs-dim' : '', row.note ? 'cs-note' : '']
    .filter(Boolean)
    .join(' ');
  const control = byId.get(row.id);
  const title = control
    ? `${control.name}: ${control.bindings.map((b) => (b.modifiers.length ? `${b.modifiers.join('+')}: ` : '') + (b.plain ? `${b.plain} (${b.action})` : b.action)).join(' / ')}${control.note ? ` (${control.note})` : ''}`
    : `${controlName(row.id)}: nothing bound`;
  const lines = row.lines.map((line, i) => {
    const dy = i === 0 ? size : size * LINE_HEIGHT;
    let content = escapeHtml(line);
    if (i === 0) {
      // The tag and the modifier are bold only where they start the first line.
      let rest = line;
      let lead = '';
      if (row.tag && rest.startsWith(row.tag)) {
        lead += `<tspan class="cs-tag">${escapeHtml(row.tag)}</tspan>`;
        rest = rest.slice(row.tag.length);
      }
      if (row.bold && rest.trimStart().startsWith(row.bold)) {
        const at = rest.indexOf(row.bold);
        lead +=
          escapeHtml(rest.slice(0, at)) + `<tspan class="cs-mod">${escapeHtml(row.bold)}</tspan>`;
        rest = rest.slice(at + row.bold.length);
      }
      content = lead + escapeHtml(rest);
    }
    return `<tspan x="${n(x + MARK + 6)}" dy="${n(dy)}">${content}</tspan>`;
  });
  const dataKind = row.kind ? ` data-kind="${row.kind}"` : '';
  return {
    h,
    svg:
      `<g class="${classes.join(' ')}" data-control="${row.id}"${dataKind}${first ? ' data-first="true"' : ''}>` +
      `<title>${escapeHtml(title)}</title>` +
      `<rect class="cs-row" x="${n(x - 3)}" y="${n(y)}" width="${n(w + 6)}" height="${n(h)}" rx="3"/>` +
      markSvg(x, y + size * 0.55 - MARK / 2 + 1, row.kind, theme) +
      `<text class="${textClass}" x="${n(x + MARK + 6)}" y="${n(y)}" font-size="${n(size)}">${lines.join('')}</text>` +
      `</g>`,
  };
}

function calloutSvg(
  callout: Callout,
  byId: Map<string, SheetControl>,
  theme: ThemeName,
  edit: boolean
): string {
  const out: string[] = [];
  const first = callout.rows.find((r) => r.kind);
  const color = first?.kind ? categoryColor(first.kind, theme) : THEMES[theme].line;
  const pointed = callout.leader.length > 0;
  if (pointed) {
    const points = callout.leader.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
    out.push(`<polyline class="cs-lead2" points="${points}"/>`);
  }
  out.push(
    `<rect class="${callout.empty ? 'cs-block cs-block-empty' : 'cs-block'}" x="${n(callout.x)}" y="${n(callout.y)}" width="${n(callout.w)}" height="${n(callout.h)}" rx="6"/>`
  );
  const headY = callout.y + PAD + HEAD_SIZE;
  out.push(
    `<text class="cs-bhead" x="${n(callout.x + PAD)}" y="${n(headY)}">${escapeHtml(callout.head)}</text>`
  );
  let y = callout.y + PAD + HEAD_SIZE * LINE_HEIGHT + 3;
  callout.rows.forEach((row, i) => {
    const made = rowSvg(
      row,
      callout.x + PAD,
      y,
      callout.w - 2 * PAD,
      callout.size,
      byId,
      theme,
      i === 0
    );
    out.push(made.svg);
    y += made.h;
  });
  // The dot where the leader meets the control, in the colour of what it does.
  const hollow = first?.kind ? categoryPattern(first.kind, theme) === 'dashed' : false;
  if (pointed) {
    out.push(
      hollow
        ? `<circle class="cs-anchor" cx="${n(callout.anchor.x)}" cy="${n(callout.anchor.y)}" r="4.5" fill="${THEMES[theme].bg}" stroke="${color}" stroke-width="2.5"/>`
        : `<circle class="cs-anchor" cx="${n(callout.anchor.x)}" cy="${n(callout.anchor.y)}" r="4.5" fill="${color}"/>`
    );
  }
  if (pointed && edit) {
    out.push(
      `<circle class="cs-anchor-handle" data-anchor-handle="${escapeHtml(callout.control.id)}" cx="${n(callout.anchor.x)}" cy="${n(callout.anchor.y)}" r="11"/>`
    );
  }
  return `<g class="cs-callout" data-anchor="${escapeHtml(callout.control.id)}" data-side="${callout.side}">${out.join('')}</g>`;
}

/** A double-headed arrow through (x, y), dx or dy long each way. */
function arrow(x: number, y: number, dx: number, dy: number): string {
  if (dy === 0) {
    return `M ${x - dx} ${y} L ${x + dx} ${y} M ${x - dx} ${y} L ${x - dx + 5} ${y - 4} M ${x - dx} ${y} L ${x - dx + 5} ${y + 4} M ${x + dx} ${y} L ${x + dx - 5} ${y - 4} M ${x + dx} ${y} L ${x + dx - 5} ${y + 4}`;
  }
  return `M ${x} ${y - dy} L ${x} ${y + dy} M ${x} ${y - dy} L ${x - 4} ${y - dy + 5} M ${x} ${y - dy} L ${x + 4} ${y - dy + 5} M ${x} ${y + dy} L ${x - 4} ${y + dy - 5} M ${x} ${y + dy} L ${x + 4} ${y + dy - 5}`;
}

/** The marker drawn on the device for a physical control, in drawing units. */
function glyphSvg(control: PhysicalControl): string {
  const { x, y } = control.at;
  const dashed = control.hidden ? ' cs-s-dashed' : '';
  const g = (inner: string): string =>
    `<g class="cs-glyph-g" data-glyph="${control.glyph}" data-physical="${escapeHtml(control.id)}">${inner}</g>`;
  switch (control.glyph) {
    case 'hat':
      return g(
        `<circle class="cs-glyph${dashed}" cx="${x}" cy="${y}" r="12"/>` +
          [
            [0, -8],
            [8, 0],
            [0, 8],
            [-8, 0],
          ]
            .map(
              ([dx, dy]) => `<circle class="cs-glyph-dot" cx="${x + dx!}" cy="${y + dy!}" r="2.2"/>`
            )
            .join('')
      );
    case 'switch':
      return g(
        `<rect class="cs-glyph${dashed}" x="${x - 10}" y="${y - 10}" width="20" height="20" rx="4"/>` +
          `<path class="cs-s-line" d="M ${x} ${y - 6} L ${x} ${y + 6} M ${x - 6} ${y} L ${x + 6} ${y}"/>`
      );
    case 'button':
      return g(`<circle class="cs-glyph${dashed}" cx="${x}" cy="${y}" r="8"/>`);
    case 'stick':
      return g(
        `<circle class="cs-glyph${dashed}" cx="${x}" cy="${y}" r="14"/>` +
          `<circle class="cs-glyph-dot" cx="${x}" cy="${y}" r="4.5"/>`
      );
    case 'rocker':
      return g(
        `<rect class="cs-glyph${dashed}" x="${x - 7}" y="${y - 14}" width="14" height="28" rx="7"/>` +
          `<path class="cs-s-line" d="M ${x - 4} ${y} L ${x + 4} ${y}"/>`
      );
    case 'knob':
      return g(
        `<circle class="cs-glyph${dashed}" cx="${x}" cy="${y}" r="12"/>` +
          `<path class="cs-s-line" d="M ${x} ${y - 10} L ${x} ${y - 3}"/>`
      );
    case 'axis':
      return g(`<path class="cs-s-line" d="${arrow(x, y, 12, 0)}"/>`);
    case 'slide':
      return g(`<path class="cs-s-line" d="${arrow(x, y, 0, 14)}"/>`);
    case 'axes':
      return g(`<path class="cs-s-line" d="${arrow(x, y, 12, 0)} ${arrow(x, y, 0, 12)}"/>`);
    case 'lever':
      return g(
        `<rect class="cs-glyph${dashed}" x="${x - 6}" y="${y - 12}" width="12" height="24" rx="5"/>`
      );
    case 'key':
    case 'none':
      return '';
  }
}

function drawingSvg(
  drawing: DeviceDrawing,
  background: RenderDrawingOptions['background']
): string {
  const out: string[] = [];
  const picture = background ?? (drawing.image ? { image: drawing.image, opacity: 1 } : undefined);
  if (picture) {
    // A photo is the device: the silhouette would only be in its way.
    out.push(
      `<image href="${escapeHtml(picture.image)}" x="0" y="0" width="${n(drawing.size.width)}" height="${n(drawing.size.height)}" opacity="${n(picture.opacity)}" preserveAspectRatio="xMidYMid meet"/>`
    );
  }
  for (const item of picture ? [] : drawing.paths) {
    const cls = `cs-s-${item.role}${item.dashed ? ' cs-s-dashed' : ''}`;
    out.push(`<path class="${cls}" d="${escapeHtml(item.d)}"/>`);
  }
  for (const text of picture ? [] : drawing.texts) {
    out.push(
      `<text class="cs-print" text-anchor="middle" x="${n(text.x)}" y="${n(text.y)}" font-size="${n(text.size)}">${escapeHtml(text.text)}</text>`
    );
  }
  for (const control of drawing.controls) out.push(glyphSvg(control));
  return out.join('');
}

function extrasSvg(
  plan: CalloutPlan,
  byId: Map<string, SheetControl>,
  theme: ThemeName,
  size: number
): string {
  const box = plan.extrasBox;
  if (!box) return '';
  const out: string[] = [];
  out.push(
    `<rect class="cs-group" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="9"/>`
  );
  out.push(
    `<text class="cs-bhead" x="${n(box.x + PAD)}" y="${n(box.y + PAD + HEAD_SIZE)}">MORE CONTROLS · not on the drawing</text>`
  );
  const colW = (box.w - (box.columns - 1) * LAYOUT_METRICS.GAP) / box.columns;
  const perColumn = Math.ceil(plan.extras.length / box.columns);
  plan.extras.forEach((row, i) => {
    const column = Math.floor(i / perColumn);
    const index = i % perColumn;
    const x = box.x + PAD + column * (colW + LAYOUT_METRICS.GAP);
    let y = box.y + PAD + HEAD_SIZE * LINE_HEIGHT + 3;
    for (let k = 0; k < index; k++) {
      const above = plan.extras[column * perColumn + k]!;
      y += above.lines.length * size * LINE_HEIGHT + 2;
    }
    out.push(rowSvg(row, x, y, colW - 2 * PAD, size, byId, theme, index === 0).svg);
  });
  return out.join('');
}

/** The picture of one device with its labels, as SVG markup. */
export function renderPlanSvg(
  plan: CalloutPlan,
  controls: SheetControl[],
  options: RenderDrawingOptions
): string {
  const theme = THEMES[options.theme];
  const byId = new Map(controls.map((c) => [c.id, c]));
  const { placed } = plan;
  const edit = options.edit ?? false;
  const out: string[] = [];
  const kind = placed ? 'cs-drawn' : 'cs-listed';
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="cs-svg cs-v2 ${kind}${edit ? ' cs-editing' : ''}" data-theme="${theme.name}" viewBox="0 0 ${n(plan.width)} ${n(plan.height)}" preserveAspectRatio="xMidYMin meet">`
  );
  out.push(`<style>${sheetCss(theme)}${extraCss(theme)}</style>`);
  out.push(`<rect class="cs-bg" x="0" y="0" width="${n(plan.width)}" height="${n(plan.height)}"/>`);
  if (placed) {
    out.push(
      `<g class="cs-drawing" data-drawing="${escapeHtml(placed.drawing.name)}" data-x="${n(placed.x)}" data-y="${n(placed.y)}" data-scale="${n(placed.scale)}" transform="translate(${n(placed.x)} ${n(placed.y)}) scale(${n(placed.scale)})">${drawingSvg(placed.drawing, options.background)}</g>`
    );
  }
  for (const callout of plan.callouts) out.push(calloutSvg(callout, byId, options.theme, edit));
  const size = plan.callouts[0]?.size ?? LAYOUT_METRICS.ROW_SIZE;
  out.push(extrasSvg(plan, byId, options.theme, size));
  out.push('</svg>');
  return out.join('');
}
