import path from 'node:path';
import type { KnownFolders } from './ports';
import { err, ok, type Result } from './result';

/** True when target is root itself or inside it. Case-insensitive, as Windows is. */
export function isWithin(root: string, target: string): boolean {
  const r = path.resolve(root).toLowerCase();
  const t = path.resolve(target).toLowerCase();
  if (r === t) return true;
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  return t.startsWith(withSep);
}

/**
 * Validates a path received from the renderer or an imported file against the
 * folders RigReady is allowed to touch. Returns the normalized absolute path.
 */
export function resolveAllowedPath(candidate: string, allowedRoots: string[]): Result<string> {
  if (candidate.includes('\0'))
    return err('path.invalid', 'The path contains an invalid character.');
  if (!path.isAbsolute(candidate)) {
    return err('path.relative', `The path must be absolute: ${candidate}`);
  }
  const resolved = path.resolve(candidate);
  if (!allowedRoots.some((root) => isWithin(root, resolved))) {
    return err('path.outside', `The path is outside the folders RigReady may use: ${resolved}`);
  }
  return ok(resolved);
}

/**
 * The folders RigReady may read and write on the user's behalf: its data root, the
 * user's Documents, Saved Games and AppData folders, and every Steam library. Use it
 * with resolveAllowedPath for any path that arrives from the renderer or from an
 * imported file. (A path the user picked in a native dialog needs no such check.)
 */
export async function allowedRoots(ports: { folders: KnownFolders }): Promise<string[]> {
  const { folders } = ports;
  const roots = [
    folders.dataRoot(),
    folders.documents(),
    folders.savedGames(),
    folders.appData(),
    folders.localAppData(),
  ];
  const libraries = await folders.steamLibraries();
  if (libraries.ok) roots.push(...libraries.value);
  return [...new Map(roots.map((r) => [path.resolve(r).toLowerCase(), path.resolve(r)])).values()];
}
