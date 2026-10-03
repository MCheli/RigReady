import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { CheckContext, RemediationDefinition } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { JsonStore } from '../../../core/jsonStore';
import { allPathVariables, collapsePath } from '../../../core/pathVariables';
import type { FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { fileName, resolveStored, shortDate } from './paths';

export const FILE_RESTORE = 'file.restore';

/**
 * Known-good copies the user saved of a config file, kept in the data root under
 * checks-generic/copies/<id>/<file name>, with an index.
 */
export const SavedCopySchema = z.object({
  id: z.string(),
  /** The file it is a copy of, in stored form ({DCS_USER}/Config/options.lua). */
  path: z.string(),
  savedAt: z.string(),
  size: z.number().int(),
  sha256: z.string(),
});
export type SavedCopy = z.infer<typeof SavedCopySchema>;

const CopyIndexSchema = z.object({ copies: z.array(SavedCopySchema).default([]) });

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

export class SavedCopies {
  private readonly store: JsonStore<typeof CopyIndexSchema>;
  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string
  ) {
    this.store = new JsonStore(files, this.indexPath, CopyIndexSchema);
  }

  private get dir(): string {
    return path.join(this.dataRoot, 'checks-generic', 'copies');
  }
  private get indexPath(): string {
    return path.join(this.dir, 'index.json');
  }
  fileOf(copy: SavedCopy): string {
    return path.join(this.dir, copy.id, fileName(copy.path));
  }

  async list(): Promise<Result<SavedCopy[]>> {
    const index = await this.store.read();
    return index.ok ? ok(index.value.copies) : index;
  }

  /** Saves the file as it is now as a known-good copy. */
  async save(stored: string, absolute: string, now: Date): Promise<Result<SavedCopy>> {
    const bytes = await this.files.readBytes(absolute);
    if (!bytes.ok) return bytes;
    const id = `${now.toISOString().replace(/[:.]/g, '-')}-${sha256(bytes.value).slice(0, 8)}`;
    const copy: SavedCopy = {
      id,
      path: stored,
      savedAt: now.toISOString(),
      size: bytes.value.length,
      sha256: sha256(bytes.value),
    };
    const written = await this.files.write(this.fileOf(copy), bytes.value, {
      reason: `Keep a copy of ${fileName(stored)}`,
    });
    if (!written.ok) return written;
    const updated = await this.store.update((index) => ({ copies: [...index.copies, copy] }));
    return updated.ok ? ok(copy) : updated;
  }
}

export const RestoreParamsSchema = z.object({
  /** The file to put back, in stored form. */
  path: z.string().min(1),
});
export type RestoreParams = z.infer<typeof RestoreParamsSchema>;

export interface RestoreSource {
  /** "the copy you saved" or "the automatic backup". */
  label: string;
  /** ISO time of the copy. */
  time: string;
  file: string;
}

const samePath = (a: string, b: string): boolean =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * The newest copy of a file RigReady has: a known-good copy the user saved, or the
 * automatic backup FileStore made before it last changed or removed the file.
 */
export async function newestSource(
  ctx: CheckContext,
  copies: SavedCopies,
  games: GameRegistry,
  stored: string,
  absolute: string
): Promise<RestoreSource | undefined> {
  const sources: RestoreSource[] = [];
  const saved = await copies.list();
  if (saved.ok) {
    const variables = await allPathVariables(ctx, games);
    for (const copy of saved.value) {
      const same =
        copy.path === stored ||
        samePath(collapsePath(absolute, variables), copy.path) ||
        (path.isAbsolute(copy.path) && samePath(copy.path, absolute));
      if (!same) continue;
      const file = copies.fileOf(copy);
      if (await ctx.ports.files.exists(file)) {
        sources.push({ label: 'the copy you saved', time: copy.savedAt, file });
      }
    }
  }
  const journal = await ctx.ports.files.journal();
  if (journal.ok) {
    for (const entry of journal.value) {
      if (!entry.backupPath || !samePath(entry.path, absolute)) continue;
      if (await ctx.ports.files.exists(entry.backupPath)) {
        sources.push({ label: 'the automatic backup', time: entry.time, file: entry.backupPath });
      }
    }
  }
  sources.sort((a, b) => b.time.localeCompare(a.time));
  return sources[0];
}

export function createRestoreRemediation(
  copies: SavedCopies,
  games: GameRegistry
): RemediationDefinition<RestoreParams> {
  const find = async (
    params: RestoreParams,
    ctx: CheckContext
  ): Promise<Result<{ target: string; source: RestoreSource | undefined }>> => {
    const target = await resolveStored(params.path, ctx, games);
    if (!target.ok) return target;
    return ok({
      target: target.value,
      source: await newestSource(ctx, copies, games, params.path, target.value),
    });
  };
  return {
    type: FILE_RESTORE,
    label: 'Restore from a backup',
    order: 300,
    params: RestoreParamsSchema,
    describe: (params) => `Restore ${fileName(params.path)}`,
    prepare: {
      label: 'Keep a copy of the file as it is now',
      async run(params, ctx) {
        const target = await resolveStored(params.path, ctx, games);
        if (!target.ok) return target;
        if (!(await ctx.ports.files.exists(target.value))) {
          return err('restore.missing', `There is no file at ${target.value} to keep a copy of.`);
        }
        const saved = await copies.save(params.path, target.value, ctx.ports.clock.now());
        if (!saved.ok) return saved;
        return ok(`Kept a copy of ${fileName(params.path)} (${shortDate(saved.value.savedAt)})`);
      },
    },
    async available(params, ctx) {
      const found = await find(params, ctx);
      if (!found.ok) return { ok: false, reason: found.error.message };
      if (!found.value.source) return { ok: false, reason: 'No backup of this file yet' };
      const { source } = found.value;
      return {
        ok: true,
        description: `Restore ${fileName(params.path)} from ${source.label} of ${shortDate(source.time)}`,
      };
    },
    async run(params, ctx) {
      const found = await find(params, ctx);
      if (!found.ok) return found;
      const { target, source } = found.value;
      if (!source) return err('restore.none', 'No backup of this file yet');
      const bytes = await ctx.ports.files.readBytes(source.file);
      if (!bytes.ok) return bytes;
      // FileStore snapshots whatever is there now first, so the restore can be undone.
      const when = shortDate(source.time);
      const written = await ctx.ports.files.write(target, bytes.value, {
        reason: `Restore ${fileName(target)} from ${source.label} of ${when}`,
      });
      if (!written.ok) return written;
      const back = await ctx.ports.files.readBytes(target);
      if (!back.ok || sha256(back.value) !== sha256(bytes.value)) {
        return err(
          'restore.verify',
          `${fileName(target)} was written but does not read back the same.`
        );
      }
      return ok(`Restored ${fileName(target)} from ${source.label} of ${when}`);
    },
  };
}
