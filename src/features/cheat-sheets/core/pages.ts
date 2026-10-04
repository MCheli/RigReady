import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './categories';
import { categorySwatch, escapeHtml, renderDeviceSvg, THEMES, type ThemeName } from './render';
import {
  summaryActions,
  actionIndex,
  entryName,
  sheetTitle,
  type ActionEntry,
  type Sheet,
  type SheetDevice,
} from './sheet';

/**
 * Whole pages as HTML documents for the Render port: a kneeboard page (one device, or a
 * list of actions) and the print document (a page per device and a summary). No script;
 * all layout is CSS, so what Chromium renders is what the user gets.
 */

export type PageStyle = 'light' | 'night';

const themeOf = (style: PageStyle): ThemeName => (style === 'night' ? 'night' : 'light');

/** The kinds of action that appear on a device, in legend order. */
export function kindsOn(device: SheetDevice): CategoryId[] {
  const present = new Set<CategoryId>();
  for (const control of device.controls) for (const b of control.bindings) present.add(b.kind);
  return CATEGORY_IDS.filter((id) => present.has(id));
}

export function legendHtml(kinds: CategoryId[], theme: ThemeName): string {
  return (
    `<div class="legend">` +
    kinds
      .map(
        (id) =>
          `<span class="chip" data-kind="${id}"><i style="background:${categorySwatch(id, theme)}"></i>${escapeHtml(CATEGORIES[id].label)}</span>`
      )
      .join('') +
    `</div>`
  );
}

function baseCss(theme: ThemeName): string {
  const t = THEMES[theme];
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${t.bg};color:${t.text};font-family:"Segoe UI",Inter,"Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{display:flex;flex-direction:column;overflow:hidden;background:${t.bg}}
.head{display:flex;align-items:flex-end;gap:14px;border-bottom:2px solid ${t.line};padding-bottom:6px;margin-bottom:8px}
.ac{font-size:26px;font-weight:800;letter-spacing:.01em;line-height:1;white-space:nowrap}
.dev{font-size:17px;font-weight:700;line-height:1.1;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dev small{display:block;font-size:11px;font-weight:500;color:${t.muted};overflow:hidden;text-overflow:ellipsis}
.brand{font-size:10.5px;color:${t.muted};text-align:right;white-space:nowrap;line-height:1.3}
.pic{flex:1;min-height:0;display:flex}
.pic svg{width:100%;height:100%}
.foot{display:flex;align-items:center;gap:10px;border-top:1px solid ${t.line};padding-top:6px;margin-top:6px;font-size:10.5px;color:${t.muted}}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;flex:1}
.chip{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;color:${t.text}}
.chip i{width:10px;height:10px;border-radius:3px;display:inline-block}
.key{white-space:nowrap}
.key b{color:${t.warn}}
.list{flex:1;min-height:0;column-gap:18px;column-fill:auto}
.kind{break-inside:avoid-column;margin:0 0 8px}
.kind h3{margin:0 0 3px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.kind h3 i{width:10px;height:10px;border-radius:3px;display:inline-block}
.row{display:flex;gap:8px;justify-content:space-between;align-items:baseline;border-bottom:1px solid ${t.emptyStroke};padding:2.5px 0;break-inside:avoid}
.row .what{font-weight:600;min-width:0;overflow-wrap:anywhere}
.row .where{color:${t.muted};text-align:right;flex-shrink:0;max-width:56%;overflow-wrap:anywhere}
.row .where b{color:${t.text};font-weight:700}
.row .where em{color:${t.accent};font-style:normal;font-weight:700}
.row .note{color:${t.accent};font-style:italic}
.empty{color:${t.muted};padding:20px 0}
`;
}

function header(sheet: Sheet, title: string, sub: string | undefined, stamp: string): string {
  return (
    `<div class="head"><div class="ac">${escapeHtml(sheetTitle(sheet))}</div>` +
    `<div class="dev">${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div>` +
    `<div class="brand">RigReady cheat sheet<br>${escapeHtml(stamp)}</div></div>`
  );
}

function deviceBlock(
  sheet: Sheet,
  device: SheetDevice,
  theme: ThemeName,
  stamp: string,
  fontScale: number
): string {
  const sub = [
    device.givenName ? device.name : undefined,
    `${device.counts.bound} of ${device.counts.placed} controls bound`,
    device.connected ? undefined : 'not connected',
  ]
    .filter(Boolean)
    .join(' · ');
  const conflicts =
    device.counts.conflicts > 0
      ? `<span class="key"><b>!</b> ${device.counts.conflicts} fire together</span>`
      : '';
  return (
    header(sheet, device.title, sub, stamp) +
    `<div class="pic">${renderDeviceSvg(device, { theme, fontScale })}</div>` +
    `<div class="foot">${legendHtml(kindsOn(device), theme)}${conflicts}</div>`
  );
}

function placeText(entry: ActionEntry): string {
  return entry.places
    .map((place) => {
      const modifiers = place.modifiers.length
        ? `<em>${escapeHtml(place.modifiers.join('+'))} + </em>`
        : '';
      const where = place.physical
        ? `${escapeHtml(place.physical)} <span>(${escapeHtml(place.controlName)})</span>`
        : escapeHtml(place.controlName);
      const note = place.note ? ` <span class="note">${escapeHtml(place.note)}</span>` : '';
      return `${escapeHtml(place.device)} · ${modifiers}<b>${where}</b>${note}`;
    })
    .join('<br>');
}

/**
 * What a list row calls an action: the binding guide's plain name when it has one. A
 * printed page holds a fixed number of rows, so the game's own name is not repeated here;
 * it is beside the plain name everywhere in the app (the detail panel, By action).
 */
function whatText(entry: ActionEntry): string {
  return escapeHtml(entryName(entry));
}

function listBlock(
  entries: ActionEntry[],
  theme: ThemeName,
  columns: number,
  fontPx: number
): string {
  if (entries.length === 0) {
    return `<div class="list empty">Nothing of your own is bound yet here.</div>`;
  }
  const byKind = new Map<CategoryId, ActionEntry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.kind) ?? [];
    list.push(entry);
    byKind.set(entry.kind, list);
  }
  const blocks = [...byKind.entries()].map(
    ([kind, list]) =>
      `<div class="kind" data-kind="${kind}"><h3><i style="background:${categorySwatch(kind, theme)}"></i>${escapeHtml(CATEGORIES[kind].label)}</h3>` +
      list
        .map(
          (entry) =>
            `<div class="row"><span class="what">${whatText(entry)}</span><span class="where">${placeText(entry)}</span></div>`
        )
        .join('') +
      `</div>`
  );
  return `<div class="list" style="column-count:${columns};font-size:${fontPx}px">${blocks.join('')}</div>`;
}

/** A kneeboard page: portrait 3:4, the size DCS kneeboard pages are usually made at. */
export const KNEEBOARD_SIZE = { width: 768, height: 1024 } as const;

function kneeboardDocument(style: PageStyle, body: string): string {
  const theme = themeOf(style);
  const { width, height } = KNEEBOARD_SIZE;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(theme)}` +
    `body{width:${width}px;height:${height}px;overflow:hidden}` +
    `.page{width:${width}px;height:${height}px;padding:14px 16px 12px}` +
    `</style></head><body class="k-${style}"><div class="page">${body}</div></body></html>`
  );
}

/** One kneeboard page: the picture of one device with its labels. */
export function kneeboardDevicePage(
  sheet: Sheet,
  device: SheetDevice,
  options: { style: PageStyle; stamp: string }
): string {
  // Kneeboards are read small: only what does something, in larger type.
  const theme = themeOf(options.style);
  const sub = [device.givenName ? device.name : undefined, `${device.counts.bound} controls bound`]
    .filter(Boolean)
    .join(' · ');
  const body =
    header(sheet, device.title, sub, options.stamp) +
    `<div class="pic">${renderDeviceSvg(device, { theme, fontScale: 1.12, showEmpty: false })}</div>` +
    `<div class="foot">${legendHtml(kindsOn(device), theme)}</div>`;
  return kneeboardDocument(options.style, body);
}

/** How many lines of actions fit a kneeboard list page in large type. */
export const KNEEBOARD_LIST_ROWS = 32;

/** A kneeboard page that lists actions and where they are, in type large enough for the cockpit. */
export function kneeboardListPage(
  sheet: Sheet,
  title: string,
  entries: ActionEntry[],
  options: { style: PageStyle; stamp: string }
): string {
  const body =
    header(sheet, title, `${entries.length} actions`, options.stamp) +
    listBlock(entries, themeOf(options.style), 1, 15.5) +
    `<div class="foot"><span>Device · control. Coloured by kind of action.</span></div>`;
  return kneeboardDocument(options.style, body);
}

export type PaperSize = 'A4' | 'Letter';

/** The printable area Chromium leaves on each paper size with its default margins, a little under. */
const PAPER: Record<PaperSize, { width: string; height: string }> = {
  A4: { width: '190mm', height: '272mm' },
  Letter: { width: '195mm', height: '254mm' },
};

/**
 * The print document: one page per device, then (optionally) a summary of the most
 * important actions. Portrait, fitting A4 and US Letter.
 */
export function printDocument(
  sheet: Sheet,
  devices: SheetDevice[],
  options: { paper: PaperSize; summary: boolean; stamp: string }
): { html: string; pages: number; css: string; body: string } {
  const paper = PAPER[options.paper];
  const pages = devices.map(
    (device) =>
      `<section class="page" data-device="${escapeHtml(device.key)}">${deviceBlock(sheet, device, 'light', options.stamp, 1)}</section>`
  );
  if (options.summary) {
    pages.push(
      `<section class="page" data-summary="true">` +
        header(
          sheet,
          'Most important actions',
          'Your own bindings, hands-on controls first',
          options.stamp
        ) +
        listBlock(summaryActions(sheet, 80), 'light', 2, 11) +
        `<div class="foot"><span>Device · control. The full list is in RigReady under Cheat sheets, By action.</span></div>` +
        `</section>`
    );
  }
  const css =
    baseCss('light') +
    `.page{width:${paper.width};height:${paper.height};margin:0 auto;page-break-after:always;break-after:page}` +
    `.page:last-child{page-break-after:auto;break-after:auto}`;
  const body = pages.join('');
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sheetTitle(sheet))} cheat sheet</title>` +
    `<style>${css}</style></head><body>${body}</body></html>`;
  return { html, pages: pages.length, css, body };
}

/** Every action of the chosen devices, for the large-print kneeboard list pages. */
export function listEntries(sheet: Sheet, deviceKey: string): ActionEntry[] {
  return actionIndex(sheet, [deviceKey]);
}
