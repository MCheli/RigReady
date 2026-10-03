import path from 'node:path';
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
