import { sha256 } from '../../../core/files/fileStore';
import type { Result } from '../../../core/result';
import type { BlobStore } from './blobs';
import { diffLines, isText, type TextDiff } from './diff';

/** One file as it was recorded: content stored by hash. */
export interface RecordedFile {
  /** Identity for matching: stored path of the file ("{DCS_USER}/Config/options.lua"). */
  key: string;
  sha256: string;
  size: number;
  /** True when its content is in the blob store (text files; every file for snapshots). */
  stored: boolean;
}

/** One file as it is now. */
export interface CurrentFile {
  key: string;
  /** Absolute path on this PC. */
  path: string;
}

export interface FileChange {
  key: string;
  /** Absolute path now, when the file exists. */
  path?: string;
  status: 'added' | 'removed' | 'changed';
  binary: boolean;
  diff?: TextDiff;
  /** Why there is no line-by-line view. */
  note?: string;
}

export interface Comparison {
  changes: FileChange[];
  unchanged: number;
}

const decoder = new TextDecoder();

/** What differs between a recorded set of files and the files now. */
export async function compareFiles(
  read: (file: string) => Promise<Result<Uint8Array>>,
  blobs: BlobStore,
  before: RecordedFile[],
  after: CurrentFile[]
): Promise<Comparison> {
  const changes: FileChange[] = [];
  let unchanged = 0;
  const now = new Map(after.map((f) => [f.key.toLowerCase(), f]));
  const then = new Map(before.map((f) => [f.key.toLowerCase(), f]));
  for (const old of before) {
    const current = now.get(old.key.toLowerCase());
    if (!current) {
      changes.push({ key: old.key, status: 'removed', binary: false });
      continue;
    }
    const bytes = await read(current.path);
    if (!bytes.ok) {
      changes.push({
        key: old.key,
        path: current.path,
        status: 'changed',
        binary: true,
        note: 'Could not be read now.',
      });
      continue;
    }
    if (sha256(bytes.value) === old.sha256) {
      unchanged++;
      continue;
    }
    const nowText = isText(bytes.value);
    if (!old.stored) {
      changes.push({
        key: old.key,
        path: current.path,
        status: 'changed',
        binary: !nowText,
        ...(nowText
          ? { note: 'The earlier version was not kept, so only "changed" is known.' }
          : {}),
      });
      continue;
    }
    const previous = await blobs.get(old.sha256);
    if (!previous.ok) {
      changes.push({
        key: old.key,
        path: current.path,
        status: 'changed',
        binary: !nowText,
        note: previous.error.message,
      });
      continue;
    }
    if (!nowText || !isText(previous.value)) {
      changes.push({ key: old.key, path: current.path, status: 'changed', binary: true });
      continue;
    }
    changes.push({
      key: old.key,
      path: current.path,
      status: 'changed',
      binary: false,
      diff: diffLines(decoder.decode(previous.value), decoder.decode(bytes.value)),
    });
  }
  for (const current of after) {
    if (then.has(current.key.toLowerCase())) continue;
    changes.push({ key: current.key, path: current.path, status: 'added', binary: false });
  }
  changes.sort((a, b) => a.key.localeCompare(b.key));
  return { changes, unchanged };
}
