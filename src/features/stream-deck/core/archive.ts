import { strFromU8, unzipSync } from 'fflate';
import { safeEntryPath } from '../../../core/files/zip';
import { err, ok, type Result } from '../../../core/result';
import type { ManifestFile } from './inventory';

/**
 * A `.streamDeckProfilesBackup` is a plain ZIP. Two layouts exist:
 * - v3 (Stream Deck 6.5+/7, BackupV3): Profiles/<uuid>.sdProfile/... plus Resources/manifest.json
 * - v2 (older): <uuid>.sdProfile/... at the root
 */

export type ArchiveFormat = 'v2' | 'v3';

export interface ArchiveSummary {
  format: ArchiveFormat;
  /** Manifest files, with paths relative to the profiles folder ("<uuid>.sdProfile/..."). */
  manifests: ManifestFile[];
}

/** Path of an archive entry relative to the profiles folder, or undefined for other entries. */
export function profileRelativePath(entry: string, format: ArchiveFormat): string | undefined {
  const rest = format === 'v3' ? /^Profiles\/(.+)$/i.exec(entry)?.[1] : entry;
  if (!rest || !/^[^/]+\.sdProfile\//i.test(rest)) return undefined;
  return rest;
}

/**
 * Reads only the manifests of an archive (images stay compressed), after checking every
 * entry name is safe and the declared size is within the limit.
 */
export function readArchiveManifests(
  bytes: Uint8Array,
  maxTotalBytes: number
): Result<ArchiveSummary> {
  let total = 0;
  const problems: Result<never>[] = [];
  const names: string[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter(file) {
        const safe = safeEntryPath(file.name);
        if (!safe.ok) {
          problems.push(safe);
          return false;
        }
        if (safe.value === undefined) return false;
        names.push(safe.value);
        total += file.originalSize;
        return /(^|\/)manifest\.json$/i.test(safe.value);
      },
    });
  } catch (e) {
    return err(
      'streamDeck.archive',
      'This file is not a Stream Deck backup RigReady can read.',
      String(e)
    );
  }
  if (problems[0]) return problems[0];
  if (total > maxTotalBytes) {
    return err(
      'zip.tooBig',
      `The backup unpacks to more than ${Math.round(maxTotalBytes / (1024 * 1024))} MB.`,
      'The limit is the import size in Settings.'
    );
  }
  const format: ArchiveFormat = names.some((n) => /^Profiles\/[^/]+\.sdProfile\//i.test(n))
    ? 'v3'
    : 'v2';
  const manifests: ManifestFile[] = [];
  for (const [name, data] of Object.entries(unzipped)) {
    const relative = profileRelativePath(name, format);
    if (relative) manifests.push({ path: relative, text: strFromU8(data) });
  }
  if (!manifests.some((m) => m.path.split('/').length === 2)) {
    return err(
      'streamDeck.archive',
      'This file does not contain any Stream Deck profiles.',
      'A Stream Deck backup holds folders named <id>.sdProfile.'
    );
  }
  return ok({ format, manifests });
}
