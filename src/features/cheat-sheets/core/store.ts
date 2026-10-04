import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type { FileStore, KnownFolders } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { builtinLayoutFor } from './builtin';
import type { DeviceShape } from './generate';
import {
  LAYOUT_EXTENSION,
  layoutMatches,
  parseLayout,
  serializeLayout,
  type DeviceLayout,
} from './layout';
import type { DeviceNotes, LayoutChoice } from './sheet';

/**
 * What the cheat sheets keep under the data root:
 *
 *   cheat-sheets/layouts/<VID>-<PID>.rrlayout.json   the user's own layouts, one per device model
 *   cheat-sheets/notes.json                          the user's notes on controls
 *   cheat-sheets/kneeboard.json                      which kneeboard pages RigReady wrote (kneeboard.ts)
 */

export const NotesFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** "<game>/<aircraft id>" -> device key -> control id -> note */
  notes: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.string().max(120))))
    .default({}),
});

export const sheetKey = (game: string, aircraftId: string): string => `${game}/${aircraftId}`;

export interface StoredLayout {
  file: string;
  layout: DeviceLayout;
}

export class CheatSheetStore {
  readonly dir: string;
  readonly layoutDir: string;
  private readonly notesFile: JsonStore<typeof NotesFileSchema>;

  constructor(
    private readonly files: FileStore,
    folders: KnownFolders,
    private readonly log: Logger
  ) {
    this.dir = path.join(folders.dataRoot(), 'cheat-sheets');
    this.layoutDir = path.join(this.dir, 'layouts');
    this.notesFile = new JsonStore(files, path.join(this.dir, 'notes.json'), NotesFileSchema);
  }

  /** The user's layout files, with the ones that cannot be read reported apart. */
  async userLayouts(): Promise<{
    good: StoredLayout[];
    broken: { file: string; reason: string }[];
  }> {
    const names = await this.files.list(this.layoutDir);
    const good: StoredLayout[] = [];
    const broken: { file: string; reason: string }[] = [];
    for (const name of names.ok ? names.value.sort() : []) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      const file = path.join(this.layoutDir, name);
      const text = await this.files.readText(file);
      if (!text.ok) {
        broken.push({ file, reason: text.error.message });
        continue;
      }
      const parsed = parseLayout(text.value);
      if (parsed.ok) good.push({ file, layout: parsed.layout });
      else broken.push({ file, reason: parsed.reason });
    }
    return { good, broken };
  }

  /**
   * A function that picks the layout for a device model: the user's own, else the shipped
   * one, else none (the caller generates one). A broken file of the user's is logged and
   * the fallback says why.
   */
  async chooser(): Promise<(shape: DeviceShape) => LayoutChoice | undefined> {
    const { good, broken } = await this.userLayouts();
    for (const item of broken) {
      this.log.warn(`cheat sheets: layout ${item.file} is not usable`, { reason: item.reason });
    }
    return (shape) => {
      const mine = good
        .filter((item) => layoutMatches(item.layout, shape.vendorId, shape.productId))
        // The file made for just this model wins over one that covers several.
        .sort((a, b) => a.layout.match.productIds.length - b.layout.match.productIds.length)[0];
      if (mine) return { layout: mine.layout, source: 'user' };
      const expected = this.fileFor(shape.vendorId, shape.productId).toLowerCase();
      const bad = broken.find((item) => item.file.toLowerCase() === expected);
      const builtin = builtinLayoutFor(shape.vendorId, shape.productId);
      const problem = bad
        ? {
            problem: `Your layout file could not be read, so ${builtin ? 'the shipped layout' : 'a generated layout'} is shown. ${bad.reason}`,
          }
        : {};
      if (builtin) return { layout: builtin, source: 'builtin', ...problem };
      return bad ? { source: 'generated', ...problem } : undefined;
    };
  }

  fileFor(vendorId: string, productId: string): string {
    return path.join(
      this.layoutDir,
      `${vendorId.toUpperCase()}-${productId.toUpperCase()}.${LAYOUT_EXTENSION}`
    );
  }

  /** Saves a layout as the user's own for one device model. */
  async saveLayout(
    layout: DeviceLayout,
    device: { vendorId: string; productId: string }
  ): Promise<Result<{ file: string }>> {
    if (!layoutMatches(layout, device.vendorId, device.productId)) {
      return err('sheet.layout', 'This layout is for another device model.');
    }
    const made = await this.files.mkdir(this.layoutDir);
    if (!made.ok) return made;
    const file = this.fileFor(device.vendorId, device.productId);
    const written = await this.files.write(file, serializeLayout(layout), {
      reason: `Save the layout of ${layout.name}`,
    });
    if (!written.ok) return written;
    return ok({ file });
  }

  /** Removes the user's own layout files for a device model; the shipped or generated one returns. */
  async resetLayout(device: {
    vendorId: string;
    productId: string;
  }): Promise<Result<{ removed: number }>> {
    const { good } = await this.userLayouts();
    let removed = 0;
    const own = this.fileFor(device.vendorId, device.productId).toLowerCase();
    const targets = new Set(
      good
        .filter((item) => layoutMatches(item.layout, device.vendorId, device.productId))
        .map((item) => item.file)
    );
    if (await this.files.exists(own)) targets.add(this.fileFor(device.vendorId, device.productId));
    for (const file of targets) {
      const gone = await this.files.remove(file, {
        reason: 'Go back to the shipped layout',
        journal: true,
      });
      if (!gone.ok) return gone;
      removed++;
    }
    return ok({ removed });
  }

  async notes(game: string, aircraftId: string): Promise<Result<DeviceNotes>> {
    const all = await this.notesFile.read();
    if (!all.ok) return all;
    return ok(all.value.notes[sheetKey(game, aircraftId)] ?? {});
  }

  /** Sets or (empty text) removes the note on one control. */
  async setNote(
    game: string,
    aircraftId: string,
    deviceKey: string,
    control: string,
    note: string
  ): Promise<Result<DeviceNotes>> {
    const made = await this.files.mkdir(this.dir);
    if (!made.ok) return made;
    const key = sheetKey(game, aircraftId);
    const text = note.trim();
    const updated = await this.notesFile.update((current) => {
      const sheet = { ...(current.notes[key] ?? {}) };
      const device = { ...(sheet[deviceKey] ?? {}) };
      if (text) device[control] = text;
      else delete device[control];
      if (Object.keys(device).length > 0) sheet[deviceKey] = device;
      else delete sheet[deviceKey];
      const notes = { ...current.notes };
      if (Object.keys(sheet).length > 0) notes[key] = sheet;
      else delete notes[key];
      return { ...current, notes };
    });
    if (!updated.ok) return updated;
    return ok(updated.value.notes[key] ?? {});
  }
}
