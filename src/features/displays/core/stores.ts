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
 */
export class RecoveryStore {
  private readonly file: string;

  constructor(
    private readonly files: FileStore,
    dataRoot: string,
    private readonly clock: Clock
  ) {
    this.file = path.join(dataRoot, 'displays', 'pending-revert.json');
  }

  async save(displays: DisplayTarget[]): Promise<Result<void>> {
    const point: RecoveryPoint = {
      schemaVersion: 1,
      savedAt: this.clock.now().toISOString(),
      displays,
    };
    const written = await this.files.write(this.file, JSON.stringify(point, null, 2) + '\n', {
      reason: 'Monitor layout before a change',
    });
    return written.ok ? ok(undefined) : written;
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
      return undefined;
    }
  }

  async clear(): Promise<void> {
    if (await this.files.exists(this.file)) {
      await this.files.remove(this.file, { reason: 'Monitor layout change settled' });
    }
  }
}
