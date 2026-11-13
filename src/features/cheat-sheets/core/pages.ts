import { CATEGORIES, CATEGORY_IDS, type CategoryId } from './categories';
import { renderPictureSvg } from './picture';
import { categorySwatch, escapeHtml, THEMES, type ThemeName } from './render';
import {
  summaryActions,
  actionIndex,
  entryName,
  sheetTitle,
  type ActionEntry,
  type ActionPlace,
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
.list{flex:1;min-height:0;overflow:hidden;display:flex;gap:${LIST.gap}px;line-height:${LIST.line}}
.col{flex:1 1 0;min-width:0}
.kind{margin:0 0 ${LIST.blockGap}px}
.kind h3{margin:0 0 3px;font-size:12px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.kind h3 i{width:10px;height:10px;border-radius:3px;display:inline-block}
.kind h3 small{font-size:10px;font-weight:500;letter-spacing:0;text-transform:none;color:${t.muted}}
.row{display:flex;gap:${LIST.rowGap}px;justify-content:space-between;align-items:baseline;border-bottom:1px solid ${t.emptyStroke};padding:2.5px 0}
.row .what{font-weight:600;flex:1 1 0;min-width:0;overflow-wrap:anywhere}
.row .where{color:${t.muted};text-align:right;flex:0 1 auto;max-width:${Math.round(LIST.whereShare * 100)}%;overflow-wrap:anywhere}
.end{display:block;width:${LIST.endWidth}px;height:${LIST.endHeight}px;margin:${LIST.endGap}px auto 0;background:${END_MARK[theme === 'night' ? 'night' : 'light']}}
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
    `<div class="pic">${renderPictureSvg(device, { theme, fontScale, fill: PRINT_FILL, maxFontScale: Math.max(fontScale, 1.3) })}</div>` +
    `<div class="foot">${legendHtml(kindsOn(device), theme)}${conflicts}</div>`
  );
}

/**
 * The measurements the list styles and the planning share. A list used to be one block
 * of CSS columns in a page of fixed height: a section that did not fit in what was left
 * went into a further column beyond the edge of the page and was never seen, and every
 * later section with it. Now every row is given its place in a column of a page before
 * anything is rendered, by the room it really takes.
 */
const LIST = {
  /** Between columns, px. */
  gap: 18,
  /** Line height of a row, in em. */
  line: 1.3,
  /** Padding and rule of a row, px. */
  rowExtra: 6,
  /** Between the action and where it is, px. */
  rowGap: 8,
  /** The most of a row's width that "where" may take. */
  whereShare: 0.56,
  /** A section heading with its margin, px. */
  heading: 19,
  /** Under a section, px. */
  blockGap: 8,
  /** The bar that ends a list. */
  endWidth: 44,
  endHeight: 6,
  endGap: 2,
  /** The most places in one row; an action bound in more places gets a further row. */
  places: 6,
  /** The most characters of a note in a row. */
  noteChars: 90,
  /** A page's heading and foot together, px, generously. */
  chrome: 84,
} as const;

/**
 * The share of a list's room that is planned to be filled. The rest allows for text that
 * runs wider than estimated; a page that still comes out too full is planned again with
 * less (see Kneeboard).
 */
export const LIST_FILL = 0.95;

/**
 * The colour of the bar that ends a list, per style. Nothing else on a page has it, so a
 * rendered picture can be checked for it: when the end of the list is in the picture,
 * nothing of the list is outside it (see pageCheck.ts).
 */
export const END_MARK: Record<PageStyle, string> = { light: '#9a8a70', night: '#aa9911' };

/** A note in a list row: a long one is cut short there (it is whole on the device's own page). */
const noteText = (note: string): string =>
  note.length > LIST.noteChars ? `${note.slice(0, LIST.noteChars - 1).trimEnd()}…` : note;

/** One place an action is bound, as a line of a list row. */
function placeHtml(place: ActionPlace, devices: boolean): string {
  const modifiers = place.modifiers.length
    ? `<em>${escapeHtml(place.modifiers.join('+'))} + </em>`
    : '';
  const where = place.physical
    ? `${escapeHtml(place.physical)} <span>(${escapeHtml(place.controlName)})</span>`
    : escapeHtml(place.controlName);
  const note = place.note ? ` <span class="note">${escapeHtml(noteText(place.note))}</span>` : '';
  return `${devices ? `${escapeHtml(place.device)} · ` : ''}${modifiers}<b>${where}</b>${note}`;
}

/** The same line as plain text, for working out how much room it takes. */
function placePlain(place: ActionPlace, devices: boolean): string {
  return (
    (devices ? `${place.device} · ` : '') +
    (place.modifiers.length ? `${place.modifiers.join('+')} + ` : '') +
    (place.physical ? `${place.physical} (${place.controlName})` : place.controlName) +
    (place.note ? ` ${noteText(place.note)}` : '')
  );
}

/**
 * What a list row calls an action: the binding guide's plain name when it has one. A
 * printed page holds a fixed number of rows, so the game's own name is not repeated here;
 * it is beside the plain name everywhere in the app (the detail panel, By action).
 */
function whatText(entry: ActionEntry): string {
  return escapeHtml(entryName(entry));
}

/** The room a list has on a page and how it is set. */
export interface ListShape {
  columns: number;
  fontPx: number;
  /** The list area of a page, px: all columns with the gaps between them, and the height of each. */
  width: number;
  height: number;
  /** Whether a row names the device (not on a page about one device). */
  devices: boolean;
}

/**
 * How wide text is, in em of its font size. Estimated from the letters, on the generous
 * side for the page font (Segoe UI): planning for too much room only leaves a page less
 * full, planning for too little would cut a row off.
 */
export function textEm(text: string, bold = false): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0x2e7f) em += 1.05;
    else if ("iljI.,:;|!' ".includes(ch)) em += 0.32;
    else if ('mwMW@%'.includes(ch)) em += 0.95;
    else if ((ch >= 'A' && ch <= 'Z') || code > 0x7f) em += 0.72;
    else if (ch >= '0' && ch <= '9') em += 0.6;
    else em += 0.58;
  }
  return em * (bold ? 1.08 : 1);
}

/** How many lines text takes in a line so many em wide. Words stay whole unless one is longer than a line. */
export function linesOf(text: string, widthEm: number, bold = false): number {
  const space = textEm(' ', bold);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = textEm(word, bold);
    if (used > 0 && used + space + w <= widthEm) {
      used += space + w;
      continue;
    }
    if (used > 0) lines++;
    // A word longer than a line is broken anywhere (overflow-wrap: anywhere).
    lines += Math.max(0, Math.ceil(w / widthEm) - 1);
    used = w > widthEm ? w % widthEm || widthEm : w;
  }
  return lines;
}

interface ListRow {
  entry: ActionEntry;
  places: ActionPlace[];
  /** True for a further row of an action bound in more places than one row holds. */
  more: boolean;
}

/** The height of a row in px, by the lines its two sides wrap to. */
function rowHeight(row: ListRow, shape: ListShape): number {
  const column = (shape.width - LIST.gap * (shape.columns - 1)) / shape.columns;
  const em = (px: number): number => px / shape.fontPx;
  const whereMax = em(column * LIST.whereShare);
  const lines = row.places.map((place) => placePlain(place, shape.devices));
  const whereWidth = Math.min(whereMax, Math.max(0, ...lines.map((line) => textEm(line, true))));
  const whereLines = lines.reduce((sum, line) => sum + linesOf(line, whereMax, true), 0);
  const whatWidth = Math.max(em(column) - em(LIST.rowGap) - whereWidth, em(column) * 0.4);
  const whatLines = linesOf(entryName(row.entry), whatWidth, true);
  return Math.max(1, whatLines, whereLines) * LIST.line * shape.fontPx + LIST.rowExtra;
}

interface ListSection {
  kind: CategoryId;
  rows: ListRow[];
  /** True when the section began in an earlier column. */
  continued: boolean;
}

/** One page of a list: its columns, and which of the list's actions begin on it. */
export interface ListPage {
  columns: ListSection[][];
  /** The first action on this page, counted from 1 over the whole list, and how many begin here. */
  from: number;
  count: number;
}

/**
 * Gives every action its place: sections by kind of action, filled column by column and
 * page by page. A section that does not fit in what is left of a column goes on in the
 * next one under its heading again, so nothing is ever pushed off a page.
 */
export function planList(entries: ActionEntry[], shape: ListShape): ListPage[] {
  const byKind = new Map<CategoryId, ActionEntry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.kind) ?? [];
    list.push(entry);
    byKind.set(entry.kind, list);
  }
  const room = shape.height - (LIST.endHeight + LIST.endGap);
  const pages: ListPage[] = [];
  let column: ListSection[] | undefined;
  let used = 0;
  let index = 0;
  const nextColumn = (): ListSection[] => {
    let page = pages.at(-1);
    if (!page || page.columns.length === shape.columns) {
      page = { columns: [], from: index + 1, count: 0 };
      pages.push(page);
    }
    const fresh: ListSection[] = [];
    page.columns.push(fresh);
    used = 0;
    return fresh;
  };
  for (const [kind, list] of byKind) {
    let begun = false;
    for (const entry of list) {
      for (let at = 0; at === 0 || at < entry.places.length; at += LIST.places) {
        const row: ListRow = {
          entry,
          places: entry.places.slice(at, at + LIST.places),
          more: at > 0,
        };
        const height = rowHeight(row, shape);
        const inSection = column?.at(-1)?.kind === kind;
        const needs = inSection ? height : LIST.heading + height + LIST.blockGap;
        if (!column || (used > 0 && used + needs > room)) column = nextColumn();
        const open = column.at(-1);
        if (open && open.kind === kind) {
          open.rows.push(row);
          used += height;
        } else {
          column.push({ kind, rows: [row], continued: begun });
          used += LIST.heading + height + LIST.blockGap;
        }
        begun = true;
        const page = pages.at(-1)!;
        if (row.more) continue;
        if (page.count === 0) page.from = index + 1;
        page.count++;
      }
      index++;
    }
  }
  return pages;
}

function rowHtml(row: ListRow, devices: boolean): string {
  const where = row.places.map((place) => placeHtml(place, devices)).join('<br>');
  return `<div class="row"><span class="what">${whatText(row.entry)}</span><span class="where">${where}</span></div>`;
}

/**
 * One planned page of a list as HTML. With `ended`, a bar after its last row marks the
 * end of what the page holds: a page that is rendered to a picture is checked for it. It
 * goes in the last column, so the check covers a list of one column, as a kneeboard's is.
 */
function listHtml(
  page: ListPage | undefined,
  theme: ThemeName,
  shape: ListShape,
  ended: boolean
): string {
  if (!page) {
    return `<div class="list empty">Nothing of your own is bound yet here.</div>`;
  }
  const mark = END_MARK[theme === 'night' ? 'night' : 'light'];
  const columns = page.columns.map((sections, at) => {
    const blocks = sections.map(
      (section) =>
        `<div class="kind" data-kind="${section.kind}"><h3><i style="background:${categorySwatch(section.kind, theme)}"></i>${escapeHtml(CATEGORIES[section.kind].label)}${section.continued ? '<small>continued</small>' : ''}</h3>` +
        section.rows.map((row) => rowHtml(row, shape.devices)).join('') +
        `</div>`
    );
    const end =
      ended && at === page.columns.length - 1 ? `<i class="end" data-must-show="${mark}"></i>` : '';
    return `<div class="col">${blocks.join('')}${end}</div>`;
  });
  // A page with fewer columns than the list has keeps the width of a column.
  for (let n = columns.length; n < shape.columns; n++) columns.push('<div class="col"></div>');
  return `<div class="list" style="font-size:${shape.fontPx}px">${columns.join('')}</div>`;
}

/** What a list page says under its title: how many actions, and which of them when the list has more pages. */
function countText(page: ListPage | undefined, total: number, pages: number): string {
  if (!page || pages < 2) return `${total} action${total === 1 ? '' : 's'}`;
  return `Actions ${page.from} to ${page.from + Math.max(1, page.count) - 1} of ${total}`;
}

/** A kneeboard page: portrait 3:4, the size DCS kneeboard pages are usually made at. */
export const KNEEBOARD_SIZE = { width: 768, height: 1024 } as const;
/**
 * The height of the picture area of a kneeboard page in canvas units (1000 wide): what a
 * drawing grows to fill, and what its labels are made as large as fits in.
 */
export const KNEEBOARD_FILL = 1230;
/** The same for a printed page, A4 or Letter. */
export const PRINT_FILL = 1280;

function kneeboardDocument(style: PageStyle, body: string): string {
  const theme = themeOf(style);
  const { width, height } = KNEEBOARD_SIZE;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(theme)}` +
    `body{width:${width}px;height:${height}px;overflow:hidden}` +
    `.page{width:${width}px;height:${height}px;padding:${KNEEBOARD_PAD.top}px ${KNEEBOARD_PAD.side}px ${KNEEBOARD_PAD.bottom}px}` +
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
    `<div class="pic">${renderPictureSvg(device, { theme, fontScale: 1.12, showEmpty: false, fill: KNEEBOARD_FILL, maxFontScale: 1.55 })}</div>` +
    `<div class="foot">${legendHtml(kindsOn(device), theme)}</div>`;
  return kneeboardDocument(options.style, body);
}

/**
 * How many lines of actions the "Key actions" summary is chosen for: what one kneeboard
 * page holds in large type when every action takes one line. With long names the summary
 * goes on to a further page instead of losing actions.
 */
export const KNEEBOARD_LIST_ROWS = 28;

/** The padding of a kneeboard page, px: top, sides, bottom. */
const KNEEBOARD_PAD = { top: 14, side: 16, bottom: 12 } as const;

export interface ListPageOptions {
  style: PageStyle;
  stamp: string;
  /** False on the list of one device: its name is the page's title, not part of every row. */
  devices?: boolean;
  /** The share of the page's room to plan for (LIST_FILL when left out). */
  fill?: number;
}

/**
 * Kneeboard pages that list actions and where they are, in type large enough for the
 * cockpit: as many pages as the actions need, each with a title of its own.
 */
export function kneeboardListPages(
  sheet: Sheet,
  title: string,
  entries: ActionEntry[],
  options: ListPageOptions
): { html: string; part: number; parts: number }[] {
  const devices = options.devices ?? true;
  const shape: ListShape = {
    columns: 1,
    fontPx: 15.5,
    width: KNEEBOARD_SIZE.width - 2 * KNEEBOARD_PAD.side,
    height:
      (KNEEBOARD_SIZE.height - KNEEBOARD_PAD.top - KNEEBOARD_PAD.bottom - LIST.chrome) *
      (options.fill ?? LIST_FILL),
    devices,
  };
  const planned: (ListPage | undefined)[] = planList(entries, shape);
  if (planned.length === 0) planned.push(undefined);
  const foot = devices
    ? 'Device · control. Coloured by kind of action.'
    : 'The control on this device. Coloured by kind of action.';
  return planned.map((page, at) => ({
    part: at + 1,
    parts: planned.length,
    html: kneeboardDocument(
      options.style,
      header(
        sheet,
        planned.length > 1 ? `${title} (${at + 1})` : title,
        countText(page, entries.length, planned.length),
        options.stamp
      ) +
        listHtml(page, themeOf(options.style), shape, true) +
        `<div class="foot"><span>${foot}</span></div>`
    ),
  }));
}

/** The first (usually the only) page of kneeboardListPages. */
export function kneeboardListPage(
  sheet: Sheet,
  title: string,
  entries: ActionEntry[],
  options: ListPageOptions
): string {
  return kneeboardListPages(sheet, title, entries, options)[0]!.html;
}

export type PaperSize = 'A4' | 'Letter';

/** The printable area Chromium leaves on each paper size with its default margins, a little under. */
const PAPER: Record<PaperSize, { width: string; height: string; mm: [number, number] }> = {
  A4: { width: '190mm', height: '272mm', mm: [190, 272] },
  Letter: { width: '195mm', height: '254mm', mm: [195, 254] },
};

/** CSS px in a millimetre. */
const PX_PER_MM = 96 / 25.4;

/** How many lines of actions the printed summary is chosen for: two columns of small type. */
export const PRINT_SUMMARY_ROWS = 80;

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
    const entries = summaryActions(sheet, PRINT_SUMMARY_ROWS);
    const shape: ListShape = {
      columns: 2,
      fontPx: 11,
      width: paper.mm[0] * PX_PER_MM,
      // A printed page cannot be checked after rendering as a kneeboard picture is: plan with more to spare.
      height: (paper.mm[1] * PX_PER_MM - LIST.chrome) * (LIST_FILL - 0.05),
      devices: true,
    };
    // Long device names take two lines a row: the summary then goes on to a further page.
    const planned: (ListPage | undefined)[] = planList(entries, shape);
    if (planned.length === 0) planned.push(undefined);
    planned.forEach((page, at) =>
      pages.push(
        `<section class="page" data-summary="true">` +
          header(
            sheet,
            planned.length > 1 ? `Most important actions (${at + 1})` : 'Most important actions',
            'Your own bindings, hands-on controls first',
            options.stamp
          ) +
          listHtml(page, 'light', shape, false) +
          `<div class="foot"><span>Device · control. The full list is in RigReady under Cheat sheets, By action.</span></div>` +
          `</section>`
      )
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
