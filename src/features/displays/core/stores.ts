import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Clock, FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { DisplayTargetSchema, type DisplayTarget } from '../../../shared/models';
import { checkMonitorName, type MonitorNames } from './labels';

const NamesSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Friendly name by monitor id (lower case). */
  names: z.record(z.string(), z.string()).default({}),
});

/** Names the user gave monitors ("MFD left"), at <data root>/displays/names.json. */
export class MonitorNameStore {
  private readonly store: JsonStore<typeof NamesSchema>;

  constructor(files: FileStore, dataRoot: string) {
    this.store = new JsonStore(files, path.join(dataRoot, 'displays', 'names.json'), NamesSchema);
  }

  async read(): Promise<Result<MonitorNames>> {
    const value = await this.store.read();
    return value.ok ? ok(value.value.names) : value;
  }

  /** The names, or none when the file cannot be read: a name is never worth failing a check. */
  async readOrEmpty(): Promise<MonitorNames> {
    const names = await this.read();
    return names.ok ? names.value : {};
  }

  /** Gives a monitor a name; an empty name removes it. */
  async set(id: string, name: string): Promise<Result<MonitorNames>> {
    const current = await this.read();
    if (!current.ok) return current;
    const checked = checkMonitorName(name, id, current.value);
    if (!checked.ok) return err('displays.name', checked.message);
    const names = { ...current.value };
    if (checked.name) names[id.toLowerCase()] = checked.name;
    else delete names[id.toLowerCase()];
    const written = await this.store.write({ schemaVersion: 1, names });
    return written.ok ? ok(written.value.names) : written;
  }
}

const RecoverySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  savedAt: z.string(),
  /** The full layout from just before a change, as apply() targets. */
  displays: z.array(DisplayTargetSchema).min(1),
});
export type RecoveryPoint = z.infer<typeof RecoverySchema>;

/**
 * The layout from before the last change, written to disk before the change is made
 * and removed once the user kept or reverted it. If RigReady is closed or crashes while
 * the keep-or-revert countdown runs, the file is still there at the next start, and the
 * user is offered the old layout back.
 *
 * Only what an earlier run left is ever offered. Once this run has written the file, it
 * holds the layout from before a change this run made itself, and the question about that
 * change is the countdown. (A start with --launch changes the layout while the window is
 * still asking whether anything was left behind.)
 */
export class RecoveryStore {
  private readonly file: string;
  /** True once this run has written the file. */
  private own = false;
  /** Writing and removing take turns, so that a removal never takes a point written after it was asked for. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: FileStore,
    dataRoot: string,
    private readonly clock: Clock
  ) {
    this.file = path.join(dataRoot, 'displays', 'pending-revert.json');
  }

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const done = this.turn.then(work, work);
    // Whoever asked for this work gets its error (through `done`); the next in line only waits for it.
    this.turn = done.catch(() => undefined);
    return done;
  }

  async save(displays: DisplayTarget[]): Promise<Result<void>> {
    // From here on the file is this run's own, also for whoever is reading it right now.
    this.own = true;
    const point: RecoveryPoint = {
      schemaVersion: 1,
      savedAt: this.clock.now().toISOString(),
      displays,
    };
    return this.inTurn(async () => {
      const written = await this.files.write(this.file, JSON.stringify(point, null, 2) + '\n', {
        reason: 'Monitor layout before a change',
      });
      return written.ok ? ok(undefined) : written;
    });
  }

  /** True when the file, if there is one, is from a change this run made. */
  get ownedByThisRun(): boolean {
    return this.own;
  }

  /**
   * The point an earlier run left behind: RigReady was closed, or crashed, while a change
   * was waiting for its answer. Undefined once this run has made a change of its own.
   */
  async leftOver(): Promise<RecoveryPoint | undefined> {
    if (this.own) return undefined;
    const point = await this.read();
    // A change that began while the file was being read: what was read may be its point.
    return this.own ? undefined : point;
  }

  /** Removes what an earlier run left behind. A point this run wrote stays: the countdown settles that one. */
  async clearLeftOver(): Promise<void> {
    await this.inTurn(async () => {
      if (!this.own) await this.remove();
    });
  }

  /** The saved point, undefined when there is none. A damaged file counts as none. */
  async read(): Promise<RecoveryPoint | undefined> {
    if (!(await this.files.exists(this.file))) return undefined;
    const text = await this.files.readText(this.file);
    if (!text.ok) return undefined;
    try {
      const parsed = RecoverySchema.safeParse(JSON.parse(text.value));
      return parsed.success ? parsed.data : undefined;
    } catch {
      // A damaged file counts as no saved point (see above): there is then nothing to offer to recover.
      return undefined;
    }
  }

  async clear(): Promise<void> {
    await this.inTurn(() => this.remove());
  }

  private async remove(): Promise<void> {
    if (await this.files.exists(this.file)) {
      await this.files.remove(this.file, { reason: 'Monitor layout change settled' });
    }
  }
}

const UprightSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** uprightKey() of every monitor-and-rotation the user has seen the right way up. */
  confirmed: z.array(z.string()).default([]),
});

/**
 * "Which way is up?": which monitors the user has looked at (Identify shows an arrow) and
 * found the right way up, at <data root>/displays/upright.json. Asked once per monitor
 * and rotation; a monitor mounted turned can be upright at 90° or at 270°, and only
 * someone looking at it can tell.
 */
export class UprightStore {
  private readonly store: JsonStore<typeof UprightSchema>;

  constructor(files: FileStore, dataRoot: string) {
    this.store = new JsonStore(
      files,
      path.join(dataRoot, 'displays', 'upright.json'),
      UprightSchema
    );
  }

  /** The confirmed keys; none when the file cannot be read. */
  async read(): Promise<string[]> {
    const value = await this.store.read();
    return value.ok ? value.value.confirmed : [];
  }

  async confirm(keys: string[]): Promise<Result<void>> {
    const saved = await this.store.update((current) => ({
      schemaVersion: 1 as const,
      confirmed: [...new Set([...current.confirmed, ...keys])],
    }));
    return saved.ok ? ok(undefined) : saved;
  }
}
