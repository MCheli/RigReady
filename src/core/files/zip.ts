import path from 'node:path';
import { unzipSync, Zip, ZipDeflate, zipSync, type Unzipped } from 'fflate';
import { isWithin } from '../paths';
import type { ChangeGroup, ChangeOptions, FileStore, TreeOptions } from '../ports';
import { err, ok, type Result } from '../result';

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  path: string;
  data: Uint8Array;
}

export interface UnzipLimits {
  /** Refuse archives whose contents add up to more than this. Default 200 MB. */
  maxTotalBytes?: number;
  /** Refuse archives with more entries than this. Default 20 000. */
  maxEntries?: number;
}

export const DEFAULT_MAX_UNZIP_BYTES = 200 * 1024 * 1024;

/**
 * Normalizes an archive entry name and rejects anything that could land outside the
 * folder it is extracted to ("zip slip"): absolute paths, drive letters, `..`, NUL.
 * Returns undefined for a directory entry.
 */
export function safeEntryPath(name: string): Result<string | undefined> {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.endsWith('/')) return ok(undefined);
  const bad =
    normalized.length === 0 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '.' || part === '');
  if (bad) return err('zip.unsafePath', `The archive contains an unsafe path: ${name}`);
  return ok(normalized);
}

/** Builds a zip archive in memory. */
export function createZip(entries: ZipEntry[]): Result<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    const safe = safeEntryPath(entry.path);
    if (!safe.ok) return safe;
    if (safe.value === undefined) continue;
    if (files[safe.value]) return err('zip.duplicate', `Two entries are named ${safe.value}.`);
    files[safe.value] = entry.data;
  }
  try {
    return ok(zipSync(files, { level: 6 }));
  } catch (e) {
    return err('zip.create', 'Could not create the archive.', String(e));
  }
}

export interface ZipSteps {
  /** Asked between files (and between slices of a big file): true stops with `zip.cancelled`. */
  cancelled?(): boolean;
  /** Called after each file. */
  onFile?(done: number, total: number): void;
}

/** A big file is compressed in slices of this size, with a pause after each. */
const ZIP_SLICE_BYTES = 1024 * 1024;

/** Lets everything else that is waiting (IPC, timers) run before the next step. */
const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Builds the same archive as createZip, one file at a time, giving the thread back between
 * files. A backup of hundreds of megabytes compressed in one go would hold the main process
 * for seconds (nothing else answers meanwhile); this way it never holds it longer than one
 * slice takes, it can report progress, and it can be cancelled before anything is written.
 */
export async function createZipInSteps(
  entries: ZipEntry[],
  steps: ZipSteps = {}
): Promise<Result<Uint8Array>> {
  const files: [string, Uint8Array][] = [];
  const names = new Set<string>();
  for (const entry of entries) {
    const safe = safeEntryPath(entry.path);
    if (!safe.ok) return safe;
    if (safe.value === undefined) continue;
    if (names.has(safe.value)) return err('zip.duplicate', `Two entries are named ${safe.value}.`);
    names.add(safe.value);
    files.push([safe.value, entry.data]);
  }
  const cancelled = (): Result<never> =>
    err('zip.cancelled', 'Cancelled before the archive was finished.');
  const chunks: Uint8Array[] = [];
  let failure: unknown;
  try {
    const zip = new Zip((error, chunk) => {
      if (error) failure = error;
      else chunks.push(chunk);
    });
    for (const [index, [name, data]] of files.entries()) {
      if (steps.cancelled?.()) return cancelled();
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      if (data.length === 0) file.push(data, true);
      for (let offset = 0; offset < data.length; offset += ZIP_SLICE_BYTES) {
        const end = Math.min(offset + ZIP_SLICE_BYTES, data.length);
        file.push(data.subarray(offset, end), end === data.length);
        if (end < data.length) {
          await breathe();
          if (steps.cancelled?.()) return cancelled();
        }
      }
      steps.onFile?.(index + 1, files.length);
      await breathe();
    }
    if (steps.cancelled?.()) return cancelled();
    zip.end();
  } catch (e) {
    failure = e;
  }
  if (failure) return err('zip.create', 'Could not create the archive.', String(failure));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return ok(out);
}

const tooBig = (maxTotal: number): Result<never> =>
  err('zip.tooBig', `The archive unpacks to more than ${Math.round(maxTotal / (1024 * 1024))} MB.`);

/**
 * Reads a zip archive from memory. Sizes are checked from the archive's directory
 * before anything is decompressed, and again on the decompressed data.
 */
export function readZip(bytes: Uint8Array, limits: UnzipLimits = {}): Result<ZipEntry[]> {
  const maxTotal = limits.maxTotalBytes ?? DEFAULT_MAX_UNZIP_BYTES;
  const maxEntries = limits.maxEntries ?? 20_000;
  let declared = 0;
  let count = 0;
  const problems: Result<never>[] = [];
  let unzipped: Unzipped;
  try {
    unzipped = unzipSync(bytes, {
      filter(file) {
        if (problems.length > 0) return false;
        const safe = safeEntryPath(file.name);
        if (!safe.ok) {
          problems.push(safe);
          return false;
        }
        if (safe.value === undefined) return false;
        count++;
        declared += file.originalSize;
        if (count > maxEntries) {
          problems.push(err('zip.tooMany', `The archive holds more than ${maxEntries} files.`));
          return false;
        }
        if (declared > maxTotal) {
          problems.push(tooBig(maxTotal));
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    return err('zip.read', 'The file is not a readable zip archive.', String(e));
  }
  if (problems[0]) return problems[0];
  const entries: ZipEntry[] = [];
  let actual = 0;
  for (const [name, data] of Object.entries(unzipped)) {
    // The directory can lie about sizes; count what really came out.
    actual += data.length;
    if (actual > maxTotal) return tooBig(maxTotal);
    entries.push({ path: name.replace(/\\/g, '/'), data });
  }
  return ok(entries);
}

/** Zips a folder (filtered like FileStore.listTree) into memory. */
export async function zipFolder(
  files: FileStore,
  dir: string,
  options: TreeOptions & { prefix?: string } = {}
): Promise<Result<Uint8Array>> {
  const tree = await files.listTree(dir, options);
  if (!tree.ok) return tree;
  const entries: ZipEntry[] = [];
  for (const file of tree.value) {
    const bytes = await files.readBytes(file.path);
    if (!bytes.ok) return bytes;
    const name = options.prefix ? `${options.prefix}/${file.relativePath}` : file.relativePath;
    entries.push({ path: name, data: bytes.value });
  }
  return createZip(entries);
}

/**
 * Extracts an archive below `destDir` through FileStore, so every file replaced is
 * backed up and the whole extraction is one journal group. Nothing is written when
 * the archive fails validation.
 */
export async function extractZip(
  files: FileStore,
  bytes: Uint8Array,
  destDir: string,
  options: ChangeOptions & UnzipLimits
): Promise<Result<{ group: ChangeGroup; files: string[] }>> {
  if (!path.isAbsolute(destDir)) {
    return err('file.relative', `The path must be absolute: ${destDir}`);
  }
  const entries = readZip(bytes, options);
  if (!entries.ok) return entries;
  const targets: { target: string; data: Uint8Array }[] = [];
  for (const entry of entries.value) {
    const target = path.join(destDir, ...entry.path.split('/'));
    // Belt and braces: safeEntryPath already rejected anything that could escape.
    if (!isWithin(destDir, target)) {
      return err('zip.unsafePath', `The archive contains an unsafe path: ${entry.path}`);
    }
    targets.push({ target, data: entry.data });
  }
  const group = options.group ?? files.beginGroup(options.reason);
  const written: string[] = [];
  for (const { target, data } of targets) {
    const result = await files.write(target, data, { reason: options.reason, group });
    if (!result.ok) return result;
    written.push(target);
  }
  return ok({ group, files: written });
}
