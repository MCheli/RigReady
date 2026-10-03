import { z } from 'zod';
import type { FileStore } from './ports';
import { err, ok, type Result } from './result';

/**
 * One JSON file validated by a schema: the usual way for a feature to keep its own
 * data under the data root (device names, tracked files, snapshots index, ...).
 *
 *   const names = new JsonStore(ctx.ports.files, path.join(dataRoot, 'devices', 'names.json'),
 *     z.object({ names: z.record(z.string(), z.string()).default({}) }));
 *   const current = await names.read();           // defaults when the file does not exist
 *   await names.update((value) => ({ ...value, names: { ...value.names, [id]: name } }));
 *
 * A file that exists but does not fit the schema is an error, never silently replaced.
 */
export class JsonStore<S extends z.ZodType> {
  constructor(
    private readonly files: FileStore,
    readonly file: string,
    private readonly schema: S,
    /** Parsed by the schema to produce the value used when the file does not exist. */
    private readonly empty: unknown = {}
  ) {}

  async read(): Promise<Result<z.output<S>>> {
    if (!(await this.files.exists(this.file))) {
      const fallback = this.schema.safeParse(this.empty);
      if (!fallback.success) {
        return err('store.invalid', `There is no default for ${this.file}.`);
      }
      return ok(fallback.data);
    }
    const text = await this.files.readText(this.file);
    if (!text.ok) return text;
    let raw: unknown;
    try {
      raw = JSON.parse(text.value);
    } catch (e) {
      return err('store.invalid', `${this.file} is not valid JSON.`, String(e));
    }
    const parsed = this.schema.safeParse(raw);
    if (!parsed.success) {
      return err('store.invalid', `${this.file} is not valid.`, z.prettifyError(parsed.error));
    }
    return ok(parsed.data);
  }

  async write(value: z.input<S>): Promise<Result<z.output<S>>> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      return err('store.invalid', 'The data is not valid.', z.prettifyError(parsed.error));
    }
    const written = await this.files.write(this.file, JSON.stringify(parsed.data, null, 2) + '\n', {
      reason: 'RigReady data',
    });
    if (!written.ok) return written;
    return ok(parsed.data);
  }

  /** Reads, applies the change, writes. */
  async update(change: (current: z.output<S>) => z.input<S>): Promise<Result<z.output<S>>> {
    const current = await this.read();
    if (!current.ok) return current;
    return this.write(change(current.value));
  }
}
