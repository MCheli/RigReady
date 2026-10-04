import path from 'node:path';
import type { ChangePreview } from '../../shared/changePreview';
import type { FileStore } from '../ports';
import { ok, type Result } from '../result';
import { sha256 } from './fileStore';

/**
 * "What will be written", before it is written. A feature that changes files outside
 * RigReady's folder describes the change as a list of planned writes; this turns it into
 * what the user is shown first: which files are created, modified (with a one-line
 * summary), renamed, deleted or left as they are, with sizes.
 *
 *   const preview = await previewWrites(ctx.ports.files, [
 *     { path: target, content: bytes },            // create or modify
 *     { path: stale, remove: true },               // delete
 *     { path: renamed, content: bytes, from: old } // rename (the old file goes away)
 *   ]);
 *
 * Nothing is written. Apply the same plan through FileStore under one beginGroup().
 */
export type PlannedWrite =
  { path: string; content: string | Uint8Array; from?: string } | { path: string; remove: true };

export type WriteChange = 'created' | 'modified' | 'unchanged' | 'renamed' | 'deleted';

export interface WritePreviewEntry {
  path: string;
  /** File name, for compact lists. */
  name: string;
  change: WriteChange;
  /** Bytes on disk now; absent when the file does not exist. */
  sizeBefore?: number;
  /** Bytes after the write; absent for a deletion. */
  sizeAfter?: number;
  /** For "renamed": the file it replaces. */
  from?: string;
  /** One line on how it changes: "3 lines added, 1 removed", "30 KB to 31 KB", "identical". */
  summary: string;
}

export interface WritePreview {
  entries: WritePreviewEntry[];
  created: number;
  modified: number;
  unchanged: number;
  renamed: number;
  deleted: number;
  /** One line for a confirmation: "2 files modified, 1 created, 3 unchanged". */
  summary: string;
}

const bytesOf = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Text that can be compared line by line: no NUL bytes, and not too large to bother. */
function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.length > 2 * 1024 * 1024) return undefined;
  for (let i = 0; i < Math.min(bytes.length, 8000); i++) if (bytes[i] === 0) return undefined;
  return new TextDecoder().decode(bytes);
}

/** Lines only in `after` and only in `before`, counted without regard to order. */
export function lineChanges(before: string, after: string): { added: number; removed: number } {
  const count = new Map<string, number>();
  for (const line of before.split(/\r?\n/)) count.set(line, (count.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split(/\r?\n/)) {
    const left = count.get(line) ?? 0;
    if (left > 0) count.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of count.values()) removed += left;
  return { added, removed };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function modifiedSummary(before: Uint8Array, after: Uint8Array): string {
  const a = textOf(before);
  const b = textOf(after);
  if (a !== undefined && b !== undefined) {
    const { added, removed } = lineChanges(a, b);
    if (added === 0 && removed === 0) return 'Line endings or spacing only';
    const parts = [];
    if (added > 0) parts.push(`${plural(added, 'line')} added`);
    if (removed > 0)
      parts.push(added > 0 ? `${removed} removed` : `${plural(removed, 'line')} removed`);
    return parts.join(', ');
  }
  return before.length === after.length
    ? `Different content, same size (${sizeText(after.length)})`
    : `${sizeText(before.length)} to ${sizeText(after.length)}`;
}

/** Describes a planned set of writes against what is on disk now. Reads only. */
export async function previewWrites(
  files: Pick<FileStore, 'readBytes' | 'exists'>,
  planned: PlannedWrite[]
): Promise<Result<WritePreview>> {
  const entries: WritePreviewEntry[] = [];
  for (const write of planned) {
    const target = path.resolve(write.path);
    const base = { path: target, name: path.basename(target) };
    const exists = await files.exists(target);
    let current: Uint8Array | undefined;
    if (exists) {
      const read = await files.readBytes(target);
      // A file that is there but cannot be read cannot be previewed, and would not be backed up.
      if (!read.ok) return read;
      current = read.value;
    }
    if ('remove' in write) {
      // Removing what is not there changes nothing.
      entries.push(
        current
          ? {
              ...base,
              change: 'deleted',
              sizeBefore: current.length,
              summary: `Deleted (${sizeText(current.length)})`,
            }
          : { ...base, change: 'unchanged', summary: 'Not there: nothing to delete' }
      );
      continue;
    }
    const next = bytesOf(write.content);
    const sizes = {
      ...(current ? { sizeBefore: current.length } : {}),
      sizeAfter: next.length,
    };
    if (write.from && path.resolve(write.from).toLowerCase() !== target.toLowerCase()) {
      entries.push({
        ...base,
        ...sizes,
        change: 'renamed',
        from: path.resolve(write.from),
        summary: `Renamed from ${path.basename(write.from)}${current ? ', replacing the file already there' : ''}`,
      });
    } else if (!current) {
      entries.push({
        ...base,
        ...sizes,
        change: 'created',
        summary: `New file (${sizeText(next.length)})`,
      });
    } else if (sha256(current) === sha256(next)) {
      entries.push({ ...base, ...sizes, change: 'unchanged', summary: 'Identical: left as it is' });
    } else {
      entries.push({
        ...base,
        ...sizes,
        change: 'modified',
        summary: modifiedSummary(current, next),
      });
    }
  }
  const count = (change: WriteChange): number => entries.filter((e) => e.change === change).length;
  const totals = {
    created: count('created'),
    modified: count('modified'),
    unchanged: count('unchanged'),
    renamed: count('renamed'),
    deleted: count('deleted'),
  };
  const parts = (['modified', 'created', 'renamed', 'deleted', 'unchanged'] as const)
    .filter((change) => totals[change] > 0)
    .map((change) => `${plural(totals[change], 'file')} ${change}`.replace(/^1 files/, '1 file'));
  return ok({
    entries,
    ...totals,
    summary: parts.length > 0 ? parts.join(', ') : 'Nothing to write',
  });
}

/**
 * The same preview in the shape that crosses IPC (src/shared/changePreview.ts) and that the
 * shared ChangePreview component shows. `label` names a planned write in the list (default:
 * the file name).
 */
export async function changePreview(
  files: Pick<FileStore, 'readBytes' | 'exists'>,
  planned: PlannedWrite[],
  label?: (write: PlannedWrite, index: number) => string | undefined
): Promise<Result<ChangePreview>> {
  const preview = await previewWrites(files, planned);
  if (!preview.ok) return preview;
  return ok({
    summary: preview.value.summary,
    files: preview.value.entries.map((entry, index) => ({
      path: entry.path,
      label: label?.(planned[index]!, index) ?? entry.name,
      change: entry.change,
      detail: entry.summary,
    })),
  });
}
