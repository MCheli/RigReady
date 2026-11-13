import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { ImageNameSchema } from '../contract';
import { KNOWN_APPS, refusedToRemember } from './processCheck';

/**
 * One program the user asked RigReady to offer in every new setup ("Always offer this
 * app"): it is then listed with the helpers RigReady knows, ticked, under the user's name
 * for it, and closed at Stand down when the user says so.
 */
export const OwnAppSchema = z.object({
  name: ImageNameSchema,
  /** What the user calls it. */
  title: z.string().trim().min(1).max(80),
  /**
   * Where the program ran when the user asked, exactly as Windows reported it. It decides
   * which running program the entry means; what Make ready starts is always the path of
   * the program running at the time of the capture, never this text.
   */
  path: z.string().min(4).max(400),
  closeAtStandDown: z.boolean().default(false),
  /** When it was added (ISO). */
  added: z.string().max(40).optional(),
});
export type OwnApp = z.infer<typeof OwnAppSchema>;

/**
 * `<data folder>/processes/known.json`. Each entry is looked at on its own when the file
 * is read, so one entry a hand edit broke hides none of the others, and the file is
 * written back with that entry as it was.
 */
const OwnAppsFileSchema = z.object({
  apps: z.array(z.unknown()).max(500).default([]),
});

/** An entry RigReady does not use, with why. */
export interface RefusedApp {
  /** The image name the entry gives, or "Entry 3" when it gives none. */
  name: string;
  why: string;
}

export interface OwnAppsRead {
  apps: OwnApp[];
  refused: RefusedApp[];
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const nameOf = (entry: unknown): string | undefined =>
  entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
    ? (entry as { name: string }).name
    : undefined;

/**
 * Sorts the entries of the file into the ones RigReady uses and the ones it refuses. The
 * never list of the capture is the authority: an entry naming RigReady, a program of
 * Windows, or one in the Windows folder is refused here, however it got into the file.
 */
export function sortOwnApps(entries: unknown[], windowsDir: string): OwnAppsRead {
  const apps: OwnApp[] = [];
  const refused: RefusedApp[] = [];
  entries.forEach((entry, index) => {
    const named = nameOf(entry);
    const label = named && named.trim() ? named.trim().slice(0, 100) : `Entry ${index + 1}`;
    const parsed = OwnAppSchema.safeParse(entry);
    if (!parsed.success) {
      refused.push({
        name: label,
        why: 'The entry is not complete: it needs a name, a title and a path.',
      });
      return;
    }
    const app = parsed.data;
    const never = refusedToRemember(app.name, app.path, windowsDir);
    if (never) {
      refused.push({ name: label, why: `RigReady never offers it: ${never}.` });
      return;
    }
    const known = KNOWN_APPS[app.name.toLowerCase()];
    if (known) {
      refused.push({ name: label, why: `RigReady offers it already, as ${known.name}.` });
      return;
    }
    if (apps.some((a) => sameName(a.name, app.name))) {
      refused.push({ name: label, why: 'It is on the list twice; the first one is used.' });
      return;
    }
    apps.push(app);
  });
  return { apps, refused };
}

/** The user's own list of apps to offer in every new setup. */
export class OwnApps {
  private readonly store: JsonStore<typeof OwnAppsFileSchema>;

  constructor(files: FileStore, dataRoot: string) {
    this.store = new JsonStore(
      files,
      path.join(dataRoot, 'processes', 'known.json'),
      OwnAppsFileSchema
    );
  }

  get file(): string {
    return this.store.file;
  }

  async read(windowsDir: string): Promise<Result<OwnAppsRead>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    return ok(sortOwnApps(read.value.apps, windowsDir));
  }

  /**
   * Puts a program on the list, in place of an entry of the same name. Refused by the same
   * rule as reading, so nothing the list would not use is ever written by RigReady.
   */
  async add(app: OwnApp, windowsDir: string): Promise<Result<OwnAppsRead>> {
    const parsed = OwnAppSchema.safeParse(app);
    if (!parsed.success) return err('process.ownApp', 'That app cannot go on the list.');
    const never = refusedToRemember(parsed.data.name, parsed.data.path, windowsDir);
    if (never) {
      return err('process.refused', `RigReady does not offer ${parsed.data.name}: ${never}.`);
    }
    const written = await this.store.update((current) => ({
      apps: [...current.apps.filter((e) => !sameName(nameOf(e) ?? '', app.name)), parsed.data],
    }));
    if (!written.ok) return written;
    return this.readBack(windowsDir, (list) =>
      list.apps.some((a) => sameName(a.name, app.name) && a.path === parsed.data.path)
    );
  }

  /** Takes every entry of that name off the list, the ones RigReady refuses included. */
  async remove(name: string, windowsDir: string): Promise<Result<OwnAppsRead>> {
    const written = await this.store.update((current) => ({
      apps: current.apps.filter((e) => !sameName(nameOf(e) ?? '', name)),
    }));
    if (!written.ok) return written;
    return this.readBack(
      windowsDir,
      (list) =>
        !list.apps.some((a) => sameName(a.name, name)) &&
        !list.refused.some((r) => sameName(r.name, name))
    );
  }

  /** The user's name for an app, and whether Stand down closes it. */
  async change(
    name: string,
    change: { title?: string; closeAtStandDown?: boolean },
    windowsDir: string
  ): Promise<Result<OwnAppsRead>> {
    const current = await this.read(windowsDir);
    if (!current.ok) return current;
    const app = current.value.apps.find((a) => sameName(a.name, name));
    if (!app) return err('process.ownApp', `${name} is not on the list of apps to offer.`);
    const next = OwnAppSchema.safeParse({ ...app, ...change });
    if (!next.success) return err('process.ownApp', 'A name is one to 80 characters.');
    const written = await this.store.update((file) => ({
      apps: file.apps.map((e) => (sameName(nameOf(e) ?? '', name) ? next.data : e)),
    }));
    if (!written.ok) return written;
    return this.readBack(windowsDir, (list) =>
      list.apps.some(
        (a) =>
          sameName(a.name, name) &&
          a.title === next.data.title &&
          a.closeAtStandDown === next.data.closeAtStandDown
      )
    );
  }

  /** No success without the file saying so. */
  private async readBack(
    windowsDir: string,
    holds: (list: OwnAppsRead) => boolean
  ): Promise<Result<OwnAppsRead>> {
    const after = await this.read(windowsDir);
    if (!after.ok) return after;
    if (!holds(after.value)) {
      return err('process.ownApp', `The change did not reach ${this.file}.`);
    }
    return after;
  }
}
