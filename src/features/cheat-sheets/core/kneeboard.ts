import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Clock, FileStore, Render } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { KneeboardOptionsSchema, type KneeboardOptions } from './kneeboardOptions';
import {
  KNEEBOARD_LIST_ROWS,
  KNEEBOARD_SIZE,
  kneeboardDevicePage,
  kneeboardListPage,
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
  pages: z.array(PageRecordSchema),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export const KneeboardManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** By aircraft type ("FA-18C_hornet"). */
  exports: z.record(z.string(), ExportRecordSchema).default({}),
});

export const PREFIX = 'RigReady - ';

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

function chosenDevices(sheet: Sheet, options: KneeboardOptions) {
  return sheet.devices.filter((device) =>
    options.devices.length > 0 ? options.devices.includes(device.key) : device.counts.bound > 0
  );
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
        ? summaryActions(sheet, KNEEBOARD_LIST_ROWS).map((e) => [e.actionId, e.places])
        : null,
    ])
  );
}

/** The pages an export writes, in kneeboard order, with their file names. */
export function planPages(sheet: Sheet, options: KneeboardOptions, stamp: string): PlannedPage[] {
  const pages: PlannedPage[] = [];
  const styles: PageStyle[] = (['light', 'night'] as const).filter((s) =>
    options.styles.includes(s)
  );
  const devices = chosenDevices(sheet, options);
  for (const style of styles) {
    // With both styles exported, each keeps its own run of numbers so either can be flipped through.
    const suffix =
      styles.length > 1 || style === 'night' ? ` (${style === 'night' ? 'night' : 'day'})` : '';
    let number = 0;
    const name = (title: string): string =>
      `${PREFIX}${style === 'night' && styles.length > 1 ? 'N' : ''}${String(++number).padStart(2, '0')} - ${fileNamePart(title)}${suffix}.png`;
    const page = { style, stamp };
    if (options.summary) {
      pages.push({
        name: name('Key actions'),
        html: kneeboardListPage(
          sheet,
          'Key actions',
          summaryActions(sheet, KNEEBOARD_LIST_ROWS),
          page
        ),
        kind: 'summary',
        style,
      });
    }
    for (const device of devices) {
      pages.push({
        name: name(device.title),
        html: kneeboardDevicePage(sheet, device, page),
        kind: 'device',
        style,
        deviceKey: device.key,
      });
      if (!options.lists) continue;
      const entries = listEntries(sheet, device.key);
      for (let at = 0, part = 1; at < entries.length; at += KNEEBOARD_LIST_ROWS, part++) {
        const many = entries.length > KNEEBOARD_LIST_ROWS;
        pages.push({
          name: name(`${device.title} list${many ? ` ${part}` : ''}`),
          html: kneeboardListPage(
            sheet,
            `${device.title}${many ? ` (${part})` : ''}`,
            entries.slice(at, at + KNEEBOARD_LIST_ROWS),
            page
          ),
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
   * Writes the pages for one aircraft into `folder`, replacing the pages RigReady wrote
   * before and nothing else. Nothing is written unless every page rendered.
   */
  async export(
    sheet: Sheet,
    folder: string,
    rawOptions: z.input<typeof KneeboardOptionsSchema>
  ): Promise<Result<ExportOutcome>> {
    const options = KneeboardOptionsSchema.parse(rawOptions);
    const { files, render, clock } = this.deps;
    const stamp = clock.now().toISOString().slice(0, 10);
    const planned = planPages(sheet, options, stamp);
    if (planned.length === 0) {
      return err('kneeboard.empty', 'There is nothing to export: no device has anything bound.');
    }
    const size = KNEEBOARD_SIZE;
    const images: Uint8Array[] = [];
    for (const page of planned) {
      const png = await renderPage(render, page.html, size);
      if (!png.ok) return png;
      images.push(png.value);
    }

    const previous = await this.record(sheet.aircraft.id);
    if (!previous.ok) return previous;
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
    const fresh = new Set(names.map((name) => name.toLowerCase()));
    for (const page of before) {
      if (fresh.has(page.file.toLowerCase())) continue;
      if (!ours.has(page.file.toLowerCase())) {
        if (await files.exists(path.join(folder, page.file))) kept.push(page.file);
        continue;
      }
      const gone = await files.remove(path.join(folder, page.file), {
        reason: `Remove the old kneeboard page ${page.file}`,
        group,
      });
      if (!gone.ok) return gone;
      removed.push(page.file);
    }
    if (elsewhere) {
      for (const page of elsewhere.pages) {
        if (!(await this.isOurs(elsewhere.folder, page))) continue;
        const gone = await files.remove(path.join(elsewhere.folder, page.file), {
          reason: `Remove the old kneeboard page ${page.file}`,
          group,
        });
        if (gone.ok) removed.push(page.file);
      }
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
          pages: records,
        },
      },
    }));
    if (!saved.ok) return saved;
    return ok({ folder, written: names, removed, kept });
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
