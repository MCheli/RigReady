import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { FakeRender } from '../../../platform/fake';
import type { CategoryId } from './categories';
import {
  KNEEBOARD_LIST_ROWS,
  PRINT_SUMMARY_ROWS,
  kneeboardListPages,
  linesOf,
  listEntries,
  planList,
  printDocument,
  textEm,
  type ListPage,
  type ListShape,
} from './pages';
import { escapeHtml } from './render';
import { entryName, summaryActions, type ActionEntry, type Sheet } from './sheet';

/**
 * Lists of actions on pages: every action gets a place by the room it really takes, and
 * a list that needs more than a page goes on to the next. The same planner makes the
 * kneeboard's "Key actions" page, its large-print lists and the printed summary.
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
const LONG = 'WINWING Orion Joystick Base 2 + JGRIP-F16 (ViperAce grip)';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});
async function start(scenario: string): Promise<WiredApp> {
  app = await wiredApp(scenario, { files: FILES });
  return app;
}

const entry = (
  n: number,
  kind: CategoryId = 'weapons',
  places = 1,
  device = 'Stick'
): ActionEntry => ({
  actionId: `a${n}`,
  action: `Action ${n}`,
  kind,
  category: [],
  source: 'user',
  places: Array.from({ length: places }, (_, at) => ({
    deviceKey: 'k',
    device,
    control: `button:${at + 1}`,
    controlName: `Button ${at + 1}`,
    modifiers: [],
  })),
});
const many = (count: number, kind: CategoryId = 'weapons', device = 'Stick'): ActionEntry[] =>
  Array.from({ length: count }, (_, at) => entry(at + 1, kind, 1, device));
/** A list area 10px type is one line a row in: 19px a row, 27px for a heading with its gap, 8px for the end bar. */
const shape = (over: Partial<ListShape> = {}): ListShape => ({
  columns: 1,
  fontPx: 10,
  width: 600,
  height: 200,
  devices: true,
  ...over,
});
const rowsIn = (page: ListPage): number[] =>
  page.columns.map((sections) => sections.reduce((n, section) => n + section.rows.length, 0));
const namesIn = (pages: ListPage[]): string[] =>
  pages.flatMap((page) =>
    page.columns.flatMap((sections) =>
      sections.flatMap((section) =>
        section.rows.filter((row) => !row.more).map((row) => row.entry.action)
      )
    )
  );
/** The actions a rendered list shows, as its rows name them. */
const rowsOf = (html: string): string[] =>
  [...html.matchAll(/<span class="what">(.*?)<\/span>/g)].map((m) => m[1]!);
const names = (entries: ActionEntry[]): string[] => entries.map((e) => escapeHtml(entryName(e)));

describe('how much room text takes', () => {
  it('counts wide letters wider than narrow ones, and bold wider than plain', () => {
    expect(textEm('')).toBe(0);
    expect(textEm('iiii')).toBeLessThan(textEm('aaaa'));
    expect(textEm('aaaa')).toBeLessThan(textEm('AAAA'));
    expect(textEm('AAAA')).toBeLessThan(textEm('MMMM'));
    expect(textEm('1234')).toBeCloseTo(2.4);
    expect(textEm('日本')).toBeCloseTo(2.1);
    expect(textEm('Trim', true)).toBeGreaterThan(textEm('Trim'));
    // On the generous side: Segoe UI sets this at about 14.3 em.
    expect(textEm('Weapon release (Button 20) and more')).toBeGreaterThan(14.3);
  });

  it('wraps at words, and breaks a word that is longer than a line', () => {
    expect(linesOf('', 10)).toBe(1);
    expect(linesOf('Gear up', 10)).toBe(1);
    const word = textEm('Throttle');
    expect(linesOf('Throttle Throttle Throttle', word * 2 + 1)).toBe(2);
    expect(linesOf('Throttle Throttle Throttle', word + 0.1)).toBe(3);
    expect(linesOf('Throttle', word / 3 + 0.01)).toBe(3);
    // The broken word's last piece shares its line with what follows when that fits.
    expect(linesOf('ThrottleThrottle i', word * 1.5)).toBe(2);
    expect(linesOf(LONG, 14, true)).toBeGreaterThan(linesOf('Stick', 14, true));
  });
});

describe('planning a list', () => {
  it('gives every action a row, and goes on in the next column and on the next page', () => {
    expect(planList([], shape())).toEqual([]);
    const one = planList(many(8), shape());
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ from: 1, count: 8 });
    expect(one[0]!.columns[0]![0]).toMatchObject({ kind: 'weapons', continued: false });

    // 200px hold a heading and eight one-line rows; the ninth goes on the next page.
    const three = planList(many(20), shape());
    expect(three.map(rowsIn)).toEqual([[8], [8], [4]]);
    expect(three.map((page) => [page.from, page.count])).toEqual([
      [1, 8],
      [9, 8],
      [17, 4],
    ]);
    expect(three.map((page) => page.columns[0]![0]!.continued)).toEqual([false, true, true]);
    expect(namesIn(three)).toEqual(many(20).map((e) => e.action));

    // Two columns: the first is filled, then the second, then the next page.
    const two = planList(many(20), shape({ columns: 2 }));
    expect(two.map(rowsIn)).toEqual([[8, 8], [4]]);
    expect(two.map((page) => [page.from, page.count])).toEqual([
      [1, 16],
      [17, 4],
    ]);
  });

  it('keeps the kinds of action apart, and never leaves a heading alone at the foot of a column', () => {
    const entries = [
      ...many(7),
      ...many(3, 'flight').map((e, at) => ({ ...e, actionId: `f${at}` })),
    ];
    const pages = planList(entries, shape());
    // Seven weapons rows leave room for one more row, but not for a heading and a row.
    expect(pages.map(rowsIn)).toEqual([[7], [3]]);
    expect(pages[1]!.columns[0]![0]).toMatchObject({ kind: 'flight', continued: false });
    expect(pages[1]).toMatchObject({ from: 8, count: 3 });
    // With room for it, the next kind follows in the same column under its own heading.
    const roomy = planList(entries, shape({ height: 400 }));
    expect(roomy).toHaveLength(1);
    expect(roomy[0]!.columns[0]!.map((s) => [s.kind, s.rows.length])).toEqual([
      ['weapons', 7],
      ['flight', 3],
    ]);
  });

  it('plans a row by the lines it wraps to, so long device names mean fewer rows on a page', () => {
    const short = planList(many(40), shape({ height: 500 }));
    const long = planList(many(40, 'weapons', `${LONG} and ${LONG}`), shape({ height: 500 }));
    expect(short.map(rowsIn)).toEqual([[24], [16]]);
    expect(long.length).toBeGreaterThan(short.length);
    expect(Math.max(...long.flatMap(rowsIn))).toBeLessThan(24);
    expect(namesIn(long)).toEqual(many(40).map((e) => e.action));
    expect(long.reduce((n, page) => n + page.count, 0)).toBe(40);
    // Without the device in each row (the list of one device) the same rows are short again.
    const own = planList(
      many(40, 'weapons', `${LONG} and ${LONG}`),
      shape({ height: 500, devices: false })
    );
    expect(own.map(rowsIn)).toEqual([[24], [16]]);
  });

  it('gives an action bound in many places further rows, and counts it once', () => {
    const entries = [entry(1), entry(2, 'weapons', 14), entry(3)];
    const pages = planList(entries, shape({ height: 1000 }));
    const rows = pages[0]!.columns[0]![0]!.rows;
    expect(rows.map((row) => [row.entry.action, row.places.length, row.more])).toEqual([
      ['Action 1', 1, false],
      ['Action 2', 6, false],
      ['Action 2', 6, true],
      ['Action 2', 2, true],
      ['Action 3', 1, false],
    ]);
    expect(pages[0]).toMatchObject({ from: 1, count: 3 });
    // A page that begins with such a further row counts from the next action.
    const tight = planList(entries, shape({ height: 160 }));
    expect(tight.length).toBeGreaterThan(1);
    expect(namesIn(tight)).toEqual(['Action 1', 'Action 2', 'Action 3']);
    expect(tight.reduce((n, page) => n + page.count, 0)).toBe(3);
    const last = tight.at(-1)!;
    expect(last.from + last.count - 1).toBe(3);
  });

  it('still places a row that is taller than a page, on a page of its own', () => {
    const tall = { ...entry(2, 'weapons', 6), actionId: 'tall' };
    const pages = planList([entry(1), tall, entry(3)], shape({ height: 60 }));
    expect(pages.map(rowsIn)).toEqual([[1], [1], [1]]);
    expect(namesIn(pages)).toEqual(['Action 1', 'Action 2', 'Action 3']);
  });
});

describe('list pages with long device names', () => {
  it('shows every key action of the kneeboard summary, each page ending with the bar that is checked', async () => {
    const running = await start('cheat-sheets-long-names');
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const wanted = summaryActions(sheet, KNEEBOARD_LIST_ROWS);
    const pages = kneeboardListPages(sheet, 'Key actions', wanted, {
      style: 'light',
      stamp: '2026-11-12',
    });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((page) => [page.part, page.parts])).toEqual(
      pages.map((_, at) => [at + 1, pages.length])
    );
    expect(pages.flatMap((page) => rowsOf(page.html))).toEqual(names(wanted));
    pages.forEach((page, at) => {
      expect(page.html).toContain(`>Key actions (${at + 1})<`);
      expect(page.html.match(/data-must-show="#9a8a70"/g)).toHaveLength(1);
      expect(page.html).toContain('.list{flex:1;min-height:0;overflow:hidden');
      expect(page.html).toContain('Device · control. Coloured by kind of action.');
    });
    // Planned with less of the page, the same actions take more pages: what a cut-off page falls back to.
    const spare = kneeboardListPages(sheet, 'Key actions', wanted, {
      style: 'night',
      stamp: '2026-11-12',
      fill: 0.65,
    });
    expect(spare.length).toBeGreaterThan(pages.length);
    expect(spare.flatMap((page) => rowsOf(page.html))).toEqual(names(wanted));
    expect(spare[0]!.html.match(/data-must-show="#aa9911"/g)).toHaveLength(1);
  });

  it('shows every action of a device on its large-print list, without the device name in each row', async () => {
    const running = await start('cheat-sheets-long-names');
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = sheet.devices.find((d) => d.key === '4098:BEA8')!;
    expect(stick.title).toBe(LONG);
    const wanted = listEntries(sheet, stick.key);
    expect(wanted.length).toBeGreaterThan(20);
    const pages = kneeboardListPages(sheet, stick.title, wanted, {
      style: 'light',
      stamp: '2026-11-12',
      devices: false,
    });
    // The list is by kind of action; every action of the stick is in it once.
    expect(pages.flatMap((page) => rowsOf(page.html)).sort()).toEqual(names(wanted).sort());
    let next = 1;
    for (const page of pages) {
      const count = rowsOf(page.html).length;
      if (pages.length > 1) {
        expect(page.html).toContain(`Actions ${next} to ${next + count - 1} of ${wanted.length}`);
      }
      next += count;
      expect(page.html).not.toContain(`${escapeHtml(LONG)} · `);
      expect(page.html).toContain('The control on this device. Coloured by kind of action.');
    }
    // The same list with the name in every row gets fewer rows on its first page: the name
    // is what made rows long.
    const named = kneeboardListPages(sheet, stick.title, wanted, {
      style: 'light',
      stamp: '2026-11-12',
    });
    expect(named.length).toBeGreaterThanOrEqual(pages.length);
    expect(rowsOf(named[0]!.html).length).toBeLessThan(rowsOf(pages[0]!.html).length);
    // Nothing bound: one page that says so, and nothing to check on it.
    const none = kneeboardListPages(sheet, 'Spare', [], { style: 'light', stamp: 'x' });
    expect(none).toHaveLength(1);
    expect(none[0]!.html).toContain('Nothing of your own is bound yet here.');
    expect(none[0]!.html).toContain('0 actions');
    expect(none[0]!.html).not.toContain('data-must-show');
    expect(
      kneeboardListPages(sheet, 'One', wanted.slice(0, 1), { style: 'light', stamp: 'x' })[0]!.html
    ).toContain('<small>1 action</small>');
  });

  it('prints every one of the most important actions, on a further page when one is not enough', async () => {
    const running = await start('cheat-sheets-long-names');
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = sheet.devices.find((d) => d.key === '4098:BEA8')!;
    const wanted = summaryActions(sheet, PRINT_SUMMARY_ROWS);
    expect(wanted.length).toBeGreaterThan(30);
    for (const paper of ['A4', 'Letter'] as const) {
      const printed = printDocument(sheet, [stick], { paper, summary: true, stamp: '2026-11-12' });
      const sections = printed.body.split('<section class="page"').slice(1);
      expect(printed.pages).toBe(sections.length);
      const summary = sections.filter((section) => section.includes('data-summary="true"'));
      expect(summary.length).toBeGreaterThan(1);
      expect(printed.pages).toBe(1 + summary.length);
      summary.forEach((section, at) =>
        expect(section).toContain(`>Most important actions (${at + 1})<`)
      );
      expect(summary.flatMap(rowsOf)).toEqual(names(wanted));
      // Two columns a page; a printed page carries no bar (there is no picture of it to check).
      expect(summary[0]!.match(/<div class="col">/g)).toHaveLength(2);
      expect(printed.html).not.toContain('data-must-show');
    }

    // Saving the PDF reports the pages it really has.
    running.ports.dialogs.script.save.push('Documents/long.pdf');
    const saved = await running.invoke<{ path: string; pages: number }>('cheat-sheets:savePdf', {
      ...HORNET,
      devices: [stick.key],
      paper: 'A4',
      summary: true,
    });
    const call = (running.ports.render as FakeRender).calls.find((c) => c.kind === 'pdf')!;
    expect(saved.pages).toBe(call.html.match(/<section class="page"/g)!.length);
    expect(saved.pages).toBeGreaterThan(2);
    expect(saved.path).toBe(path.join(running.home, 'Documents', 'long.pdf'));
  });

  it('needs fewer printed pages when the names are short, and one when there is little to list', async () => {
    const running = await start('cheat-sheets-hornet');
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const printed = printDocument(sheet, [], { paper: 'A4', summary: true, stamp: '2026-11-12' });
    // 71 actions, the panels' among them with names that take two lines: two pages, not three.
    expect(printed.pages).toBe(2);
    expect(printed.body).toContain('>Most important actions (2)<');
    expect(rowsOf(printed.body)).toEqual(names(summaryActions(sheet, PRINT_SUMMARY_ROWS)));

    // The UH-1H has only the game's own bindings: the summary is one page that says so.
    const huey = await running.invoke<Sheet>('cheat-sheets:sheet', {
      game: 'dcs',
      aircraftId: 'UH-1H',
    });
    const bare = printDocument(huey, [], { paper: 'A4', summary: true, stamp: '2026-11-12' });
    expect(bare.pages).toBe(1);
    expect(bare.body).toContain('>Most important actions<');
    expect(bare.body).toContain('Nothing of your own is bound yet here.');
  });
});
