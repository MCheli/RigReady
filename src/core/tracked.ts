import path from 'node:path';
import { credentialReason } from './credentials';
import { expandPath, variableOf, type PathVariables } from './pathVariables';
import type { FileStore } from './ports';

export {
  BACKUP_EXTENSION,
  BackupExtensionSchema,
  TrackedItemSchema,
  type TrackedItem,
} from './trackedSchema';
import type { TrackedItem } from './trackedSchema';

export interface TrackedFile {
  path: string;
  /** Below the item's folder, forward slashes; the file name for a single-file item. */
  relativePath: string;
  size: number;
  mtimeMs: number;
}

export interface ResolvedItem {
  item: TrackedItem;
  /** Undefined when the path cannot be resolved on this PC. */
  absolute?: string;
  /** Why it cannot be resolved, or why it could not be listed. */
  problem?: string;
  exists: boolean;
  files: TrackedFile[];
  /** Files left out because they hold credentials. */
  withheld: { relativePath: string; reason: string }[];
}

/** "{DCS_USER}" in words, for messages. */
export function unknownVariableText(stored: string): string {
  const name = variableOf(stored);
  return name
    ? `{${name}} is not on this PC (the game or tool it belongs to was not found).`
    : `The path is not valid: ${stored}`;
}

/** Where the item is on this PC and which files it covers right now. */
export async function resolveTrackedItem(
  files: FileStore,
  item: TrackedItem,
  variables: PathVariables
): Promise<ResolvedItem> {
  const expanded = expandPath(item.path, variables);
  if (!expanded.ok) {
    const problem =
      expanded.error.code === 'path.variable' && variableOf(item.path)
        ? unknownVariableText(item.path)
        : expanded.error.message;
    return { item, problem, exists: false, files: [], withheld: [] };
  }
  const absolute = expanded.value;
  const base = {
    item,
    absolute,
    files: [] as TrackedFile[],
    withheld: [] as ResolvedItem['withheld'],
  };
  const stat = await files.stat(absolute);
  if (!stat.ok) return { ...base, exists: false, problem: stat.error.message };
  if (!stat.value) return { ...base, exists: false };
  if (item.kind === 'file' || !stat.value.isDirectory) {
    const name = path.basename(absolute);
    const reason = credentialReason(absolute, variables);
    if (reason) return { ...base, exists: true, withheld: [{ relativePath: name, reason }] };
    return {
      ...base,
      exists: true,
      files: [
        { path: absolute, relativePath: name, size: stat.value.size, mtimeMs: stat.value.mtimeMs },
      ],
    };
  }
  const tree = await files.listTree(absolute, {
    ...(item.include.length ? { include: item.include } : {}),
    ...(item.exclude.length ? { exclude: item.exclude } : {}),
  });
  if (!tree.ok) return { ...base, exists: true, problem: tree.error.message };
  const out: TrackedFile[] = [];
  const withheld: ResolvedItem['withheld'] = [];
  for (const entry of tree.value) {
    const reason = credentialReason(entry.path, variables);
    if (reason) withheld.push({ relativePath: entry.relativePath, reason });
    else
      out.push({
        path: entry.path,
        relativePath: entry.relativePath,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
      });
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { ...base, exists: true, files: out, withheld };
}

/** Where one file of an item goes on this PC. */
export function trackedFileTarget(
  item: Pick<TrackedItem, 'kind'>,
  absolute: string,
  relativePath: string
): string {
  return item.kind === 'file' ? absolute : path.join(absolute, ...relativePath.split('/'));
}
