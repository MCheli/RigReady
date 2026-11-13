import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { PlannedWrite } from '../../../core/files/preview';
import { JsonStore } from '../../../core/jsonStore';
import type { Clock, FileStore, Render } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { KneeboardOptionsSchema, type KneeboardOptions } from './kneeboardOptions';
import { pageComplete } from './pageCheck';
import {
  KNEEBOARD_LIST_ROWS,
  KNEEBOARD_SIZE,
  LIST_FILL,
  kneeboardDevicePage,
  kneeboardListPages,
  listEntries,
  type PageStyle,
} from './pages';
import { deviceFingerprint, fingerprintOf, summaryActions, type Sheet } from './sheet';

/**
 * Cheat sheets as DCS kneeboard pages: PNG files in Saved Games\DCS\Kneeboard\<aircraft
 * type>\. DCS shows every image in that folder in name order, matches the extension
 * case-sensitively and stretches each image onto the kneeboard, so pages are portrait
 * 3:4, named "RigReady - 01 - ..." with a lower-case .png.
 *
 * RigReady keeps a manifest of the files it wrote (with their hashes). Only those are
 * ever replaced or removed; a page of the user's own, or one of ours the user has changed
 * since, is left alone. Every write goes through FileStore (backup, journal, undo).
 */

export { KneeboardOptionsSchema, type KneeboardOptions };

const PageRecordSchema = z.object({
  file: z.string(),
  sha256: z.string(),
  kind: z.enum(['summary', 'device', 'list']),
  style: z.enum(['light', 'night']),
  deviceKey: z.string().optional(),
});
export type PageRecord = z.infer<typeof PageRecordSchema>;

const ExportRecordSchema = z.object({
  folder: z.string(),
  aircraftName: z.string(),
  exportedAt: z.string(),
  options: KneeboardOptionsSchema,
  /** What the pages showed when they were written (see pagesFingerprint). */
  fingerprint: z.string(),
  /** How the pages were laid out (PAGE_LAYOUT). Exports from before it was recorded are 1. */
  layout: z.number().int().default(1),
  pages: z.array(PageRecordSchema),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export const KneeboardManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** By aircraft type ("FA-18C_hornet"). */
  exports: z.record(z.string(), ExportRecordSchema).default({}),
});

export const PREFIX = 'RigReady - ';

/**
 * The layout of the pages. Layout 1 could cut a list off at the edge of the page (a
 * section that did not fit was never seen); pages made with it are reported as needing a
 * new export. Raise it whenever pages already exported would come out wrong.
 */
export const PAGE_LAYOUT = 2;

/**
 * How full a list page is planned, one try after another: when a rendered page shows that
 * part of its list was cut off, the pages are planned again with more room to spare.
 */
const FILLS = [LIST_FILL, 0.8, 0.65] as const;

export interface PlannedPage {
  name: string;
  html: string;
  kind: PageRecord['kind'];
  style: PageStyle;
  deviceKey?: string;
}

/** A device or page title as part of a file name. */
export function fileNamePart(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (clean || 'Device').slice(0, 44).trim();
}

/**
 * The devices that get pages. `order` is the device keys in the page order of the last
 * export: a device keeps the place it had, and a new one goes after them. Without it the
 * sheet's own order decides, which follows what is bound and so changes with the bindings:
 * that order alone would give a device another page number from one export to the next.
 */
function chosenDevices(sheet: Sheet, options: KneeboardOptions, order: string[] = []) {
  const chosen = sheet.devices.filter((device) =>
    options.devices.length > 0 ? options.devices.includes(device.key) : device.counts.bound > 0
  );
  const place = (key: string): number => {
    const at = order.indexOf(key);
    return at < 0 ? order.length : at;
  };
  return chosen
    .map((device, at) => ({ device, at }))
    .sort((a, b) => place(a.device.key) - place(b.device.key) || a.at - b.at)
    .map(({ device }) => device);
}

/** The device keys of an export in page order, each once. */
export function pageOrder(record: Pick<ExportRecord, 'pages'> | undefined): string[] {
  const keys: string[] = [];
  for (const page of record?.pages ?? []) {
    if (page.deviceKey && !keys.includes(page.deviceKey)) keys.push(page.deviceKey);
  }
  return keys;
}

/**
 * The letter after a page number: nothing for the first page of an entry, then b, c and
 * so on ("02", "02b", "02c"; after z comes zb). Names with a letter sort after the plain
 * number and before the next one, which is the order DCS shows pages in.
 */
export function pageLetter(n: number): string {
  if (n <= 0) return '';
  return n <= 25 ? String.fromCharCode(97 + n) : `z${pageLetter(n - 25)}`;
}

export interface PagePlan {
  /** The device keys in the page order of the last export (see pageOrder). */
  order?: string[];
  /** The share of a list page's room to plan for. */
  fill?: number;
}

/** What the exported pages show, as one fingerprint: it changes when a binding, a note, a layout or an option does. */
export function pagesFingerprint(sheet: Sheet, options: KneeboardOptions): string {
  return fingerprintOf(
    JSON.stringify([
      [...options.styles].sort(),
      options.summary,
      options.lists,
      chosenDevices(sheet, options).map((device) => [device.key, deviceFingerprint(device)]),
      options.summary
        ? summaryActions(sheet, KNEEBOARD_LIST_ROWS).map((e) => [
            e.actionId,
            e.places,
            ...(e.plain ? [e.plain] : []),
          ])
        : null,
    ])
  );
}

/**
 * The pages an export writes, in kneeboard order, with their file names.
 *
 * The summary and each device have one number each. A further page of the same entry (the
 * summary going on, a device's list) carries that number with a letter: "02 - Stick",
 * "02b - Stick list". So a list that grows by a page, or lists switched on, never moves
 * the number of another device.
 */
export function planPages(
  sheet: Sheet,
  options: KneeboardOptions,
  stamp: string,
  plan: PagePlan = {}
): PlannedPage[] {
  const pages: PlannedPage[] = [];
  const styles: PageStyle[] = (['light', 'night'] as const).filter((s) =>
    options.styles.includes(s)
  );
  const devices = chosenDevices(sheet, options, plan.order);
  for (const style of styles) {
    // With both styles exported, each keeps its own run of numbers so either can be flipped through.
    const suffix =
      styles.length > 1 || style === 'night' ? ` (${style === 'night' ? 'night' : 'day'})` : '';
    let number = 0;
    /**
     * The names of one entry's pages: the next number, then that number with a letter. What
     * a page is (" list", " 2") goes after the title, so a long device name that is cut
     * short still says it.
     */
    const entry = (): ((title: string, what?: string) => string) => {
      const digits = String(++number).padStart(2, '0');
      let part = 0;
      return (title, what = '') =>
        `${PREFIX}${style === 'night' && styles.length > 1 ? 'N' : ''}${digits}${pageLetter(part++)} - ${fileNamePart(title)}${what}${suffix}.png`;
    };
    const page = { style, stamp, ...(plan.fill ? { fill: plan.fill } : {}) };
    if (options.summary) {
      const name = entry();
      const actions = summaryActions(sheet, KNEEBOARD_LIST_ROWS);
      for (const list of kneeboardListPages(sheet, 'Key actions', actions, page)) {
        pages.push({
          name: name('Key actions', list.part > 1 ? ` ${list.part}` : ''),
          html: list.html,
          kind: 'summary',
          style,
        });
      }
    }
    for (const device of devices) {
      const name = entry();
      pages.push({
        name: name(device.title),
        html: kneeboardDevicePage(sheet, device, page),
        kind: 'device',
        style,
        deviceKey: device.key,
      });
      if (!options.lists) continue;
      const entries = listEntries(sheet, device.key);
      if (entries.length === 0) continue;
      // The page is about one device, so its rows do not repeat the device's name.
      const lists = kneeboardListPages(sheet, device.title, entries, { ...page, devices: false });
      for (const list of lists) {
        pages.push({
          name: name(device.title, ` list${list.part > 1 ? ` ${list.part}` : ''}`),
          html: list.html,
          kind: 'list',
          style,
          deviceKey: device.key,
        });
      }
    }
  }
  return pages;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Renders one page. Capturing a page can fail when the picture is asked for before the
 * first frame at a new size has been drawn; the same request then works a moment later,
 * so it is tried a few times before the failure is reported.
 */
export async function renderPage(
  render: Render,
  html: string,
  size: { width: number; height: number },
  attempts = 4
): Promise<Result<Uint8Array>> {
  let last = await render.png(html, { width: size.width, height: size.height });
  for (
    let attempt = 1;
    !last.ok && last.error.code === 'render.png' && attempt < attempts;
    attempt++
  ) {
    last = await render.png(html, { width: size.width, height: size.height });
  }
  return last;
}

export interface KneeboardDeps {
  files: FileStore;
  render: Render;
  clock: Clock;
  /** <data root>/cheat-sheets */
  dir: string;
}

export interface ExportOutcome {
  folder: string;
  written: string[];
  removed: string[];
  /** Files in the way that are not RigReady's (or were changed since): left as they are. */
  kept: string[];
}

export type KneeboardState = 'none' | 'current' | 'stale' | 'missing';

export interface KneeboardStatus {
  state: KneeboardState;
  /** One line for the user. */
  summary: string;
  folder?: string;
  exportedAt?: string;
  pages: string[];
  options?: KneeboardOptions;
  /** Why nothing can be written or removed right now (the game is running), when so. */
  blocked?: string;
}

export class Kneeboard {
  private readonly manifest: JsonStore<typeof KneeboardManifestSchema>;

  constructor(private readonly deps: KneeboardDeps) {
    this.manifest = new JsonStore(
      deps.files,
      path.join(deps.dir, 'kneeboard.json'),
      KneeboardManifestSchema
    );
  }

  async record(aircraftId: string): Promise<Result<ExportRecord | undefined>> {
    const manifest = await this.manifest.read();
    if (!manifest.ok) return manifest;
    return ok(manifest.value.exports[aircraftId]);
  }

  async records(): Promise<Result<Record<string, ExportRecord>>> {
    const manifest = await this.manifest.read();
    return manifest.ok ? ok(manifest.value.exports) : manifest;
  }

  /** True when the file is one RigReady wrote and nobody has changed it since. */
  private async isOurs(folder: string, page: PageRecord): Promise<boolean> {
    const bytes = await this.deps.files.readBytes(path.join(folder, page.file));
    return bytes.ok && sha256(bytes.value) === page.sha256;
  }

  /**
   * Everything an export would do, worked out without writing: the rendered pages, the
   * names they get, and the pages of an earlier export that go away.
   */
  private async prepare(
    sheet: Sheet,
    folder: string,
    rawOptions: z.input<typeof KneeboardOptionsSchema>
  ) {
    const options = KneeboardOptionsSchema.parse(rawOptions);
    const { files, render, clock } = this.deps;
    const stamp = clock.now().toISOString().slice(0, 10);
    const previous = await this.record(sheet.aircraft.id);
    if (!previous.ok) return previous;
    // Devices keep the page they had in the last export, so page numbers stay put.
    const order = pageOrder(previous.value);
    const size = KNEEBOARD_SIZE;
    let planned: PlannedPage[] = [];
    let images: Uint8Array[] = [];
    let cutOff: string | undefined;
    // A page that was rendered and found whole is not rendered again when the pages are planned anew.
    const whole = new Map<string, Uint8Array>();
    for (const fill of FILLS) {
      planned = planPages(sheet, options, stamp, { order, fill });
      if (planned.length === 0) {
        return err('kneeboard.empty', 'There is nothing to export: no device has anything bound.');
      }
      images = [];
      cutOff = undefined;
      for (const page of planned) {
        let image = whole.get(page.html);
        if (!image) {
          const png = await renderPage(render, page.html, size);
          if (!png.ok) return png;
          // The check after rendering: the end of the page's list is in the picture.
          const complete = pageComplete(page.html, png.value);
          if (!complete.ok) return complete;
          if (!complete.value) {
            cutOff = page.name;
            break;
          }
          image = png.value;
          whole.set(page.html, image);
        }
        images.push(image);
      }
      if (!cutOff) break;
    }
    if (cutOff) {
      return err(
        'kneeboard.fit',
        `The list on "${cutOff}" did not fit on its page, so nothing was written. Shorter device names make it fit.`
      );
    }

    const before = previous.value?.folder === folder ? previous.value.pages : [];
    // An earlier export into another folder (DCS moved) is cleaned up like any other.
    const elsewhere =
      previous.value && previous.value.folder !== folder ? previous.value : undefined;

    const ours = new Set<string>();
    for (const page of before) {
      if (await this.isOurs(folder, page)) ours.add(page.file.toLowerCase());
    }
    const existing = await files.list(folder);
    const taken = new Set((existing.ok ? existing.value : []).map((name) => name.toLowerCase()));

    const kept: string[] = [];
    const names = planned.map((page) => {
      let name = page.name;
      // A file of that name that is not ours is the user's: ours gets another name.
      for (let n = 2; taken.has(name.toLowerCase()) && !ours.has(name.toLowerCase()); n++) {
        if (n === 2) kept.push(page.name);
        name = page.name.replace(/\.png$/, ` (${n}).png`);
      }
      taken.add(name.toLowerCase());
      return name;
    });

    // Pages of the last export that this one does not write again: ours go, changed ones stay.
    const fresh = new Set(names.map((name) => name.toLowerCase()));
    const stale: string[] = [];
    for (const page of before) {
      if (fresh.has(page.file.toLowerCase())) continue;
      if (ours.has(page.file.toLowerCase())) stale.push(path.join(folder, page.file));
      else if (await files.exists(path.join(folder, page.file))) kept.push(page.file);
    }
    const staleElsewhere: string[] = [];
    for (const page of elsewhere?.pages ?? []) {
      if (await this.isOurs(elsewhere!.folder, page)) {
        staleElsewhere.push(path.join(elsewhere!.folder, page.file));
      }
    }
    return ok({ options, planned, images, names, kept, stale, staleElsewhere });
  }

  /** What an export would write and remove, for the "this is what will change" list. */
  async exportWrites(
    sheet: Sheet,
    folder: string,
    rawOptions: z.input<typeof KneeboardOptionsSchema>
  ): Promise<Result<PlannedWrite[]>> {
    const prepared = await this.prepare(sheet, folder, rawOptions);
    if (!prepared.ok) return prepared;
    const { names, images, stale, staleElsewhere } = prepared.value;
    return ok([
      ...names.map((name, i) => ({ path: path.join(folder, name), content: images[i]! })),
      ...[...stale, ...staleElsewhere].map((file) => ({ path: file, remove: true as const })),
    ]);
  }

  /**
   * Writes the pages for one aircraft into `folder`, replacing the pages RigReady wrote
   * before and nothing else. Nothing is written unless every page rendered.
   */
  async export(
    sheet: Sheet,
    folder: string,
    rawOptions: z.input<typeof KneeboardOptionsSchema>
  ): Promise<Result<ExportOutcome>> {
    const prepared = await this.prepare(sheet, folder, rawOptions);
    if (!prepared.ok) return prepared;
    const { options, planned, images, names, kept, stale, staleElsewhere } = prepared.value;
    const { files, clock } = this.deps;

    const count = `${planned.length} kneeboard page${planned.length === 1 ? '' : 's'}`;
    const group = files.beginGroup(`Export ${count} for ${sheet.aircraft.name}`);
    const made = await files.mkdir(folder);
    if (!made.ok) return made;
    const records: PageRecord[] = [];
    for (let i = 0; i < planned.length; i++) {
      const page = planned[i]!;
      const written = await files.write(path.join(folder, names[i]!), images[i]!, {
        reason: `Kneeboard page ${names[i]}`,
        group,
      });
      if (!written.ok) return written;
      records.push({
        file: names[i]!,
        sha256: sha256(images[i]!),
        kind: page.kind,
        style: page.style,
        ...(page.deviceKey ? { deviceKey: page.deviceKey } : {}),
      });
    }
    const removed: string[] = [];
    for (const file of stale) {
      const gone = await files.remove(file, {
        reason: `Remove the old kneeboard page ${path.basename(file)}`,
        group,
      });
      if (!gone.ok) return gone;
      removed.push(path.basename(file));
    }
    for (const file of staleElsewhere) {
      const gone = await files.remove(file, {
        reason: `Remove the old kneeboard page ${path.basename(file)}`,
        group,
      });
      if (gone.ok) removed.push(path.basename(file));
    }
    // Read back: every page is on disk as written.
    for (const record of records) {
      if (!(await this.isOurs(folder, record))) {
        return err('kneeboard.verify', `${record.file} is not on disk as it was written.`);
      }
    }
    const saved = await this.manifest.update((current) => ({
      ...current,
      exports: {
        ...current.exports,
        [sheet.aircraft.id]: {
          folder,
          aircraftName: sheet.aircraft.name,
          exportedAt: clock.now().toISOString(),
          options,
          fingerprint: pagesFingerprint(sheet, options),
          layout: PAGE_LAYOUT,
          pages: records,
        },
      },
    }));
    if (!saved.ok) return saved;
    return ok({ folder, written: names, removed, kept });
  }

  /** The pages a removal would delete, for the "this is what will change" list. */
  async removeWrites(aircraftId: string): Promise<Result<PlannedWrite[]>> {
    const record = await this.record(aircraftId);
    if (!record.ok) return record;
    const writes: PlannedWrite[] = [];
    for (const page of record.value?.pages ?? []) {
      const file = path.join(record.value!.folder, page.file);
      if (!(await this.deps.files.exists(file))) continue;
      if (await this.isOurs(record.value!.folder, page)) writes.push({ path: file, remove: true });
    }
    return ok(writes);
  }

  /** Removes the pages RigReady wrote for an aircraft. Pages changed since are left and named. */
  async remove(aircraftId: string): Promise<Result<{ removed: string[]; kept: string[] }>> {
    const record = await this.record(aircraftId);
    if (!record.ok) return record;
    if (!record.value) return ok({ removed: [], kept: [] });
    const { files } = this.deps;
    const group = files.beginGroup(`Remove the kneeboard pages for ${record.value.aircraftName}`);
    const removed: string[] = [];
    const kept: string[] = [];
    for (const page of record.value.pages) {
      const file = path.join(record.value.folder, page.file);
      if (!(await files.exists(file))) continue;
      if (!(await this.isOurs(record.value.folder, page))) {
        kept.push(page.file);
        continue;
      }
      const gone = await files.remove(file, {
        reason: `Remove kneeboard page ${page.file}`,
        group,
      });
      if (!gone.ok) return gone;
      removed.push(page.file);
    }
    const saved = await this.manifest.update((current) => {
      const exports = { ...current.exports };
      delete exports[aircraftId];
      return { ...current, exports };
    });
    if (!saved.ok) return saved;
    return ok({ removed, kept });
  }

  /** Whether the exported pages still show what is bound now. */
  async status(sheet: Sheet): Promise<Result<KneeboardStatus>> {
    const found = await this.record(sheet.aircraft.id);
    if (!found.ok) return found;
    const record = found.value;
    if (!record) {
      return ok({
        state: 'none',
        summary: `No kneeboard pages exported for ${sheet.aircraft.name}`,
        pages: [],
      });
    }
    const base = {
      folder: record.folder,
      exportedAt: record.exportedAt,
      pages: record.pages.map((p) => p.file),
      options: record.options,
    };
    const missing: string[] = [];
    for (const page of record.pages) {
      if (!(await this.deps.files.exists(path.join(record.folder, page.file)))) {
        missing.push(page.file);
      }
    }
    if (missing.length > 0) {
      return ok({
        ...base,
        state: 'missing',
        summary:
          missing.length === record.pages.length
            ? `The kneeboard pages for ${sheet.aircraft.name} are gone from the Kneeboard folder`
            : `${missing.length} of ${record.pages.length} kneeboard pages for ${sheet.aircraft.name} are missing`,
      });
    }
    // Only a page with a list could be cut off; a device's picture was always scaled to fit.
    if (record.layout < PAGE_LAYOUT && record.pages.some((page) => page.kind !== 'device')) {
      return ok({
        ...base,
        state: 'stale',
        summary: `The kneeboard pages for ${sheet.aircraft.name} were made by an older RigReady and can have a list cut off`,
      });
    }
    if (pagesFingerprint(sheet, record.options) !== record.fingerprint) {
      return ok({
        ...base,
        state: 'stale',
        summary: `The kneeboard pages for ${sheet.aircraft.name} no longer match the bindings`,
      });
    }
    return ok({
      ...base,
      state: 'current',
      summary: `${record.pages.length} kneeboard page${record.pages.length === 1 ? '' : 's'} for ${sheet.aircraft.name} match the bindings`,
    });
  }
}
