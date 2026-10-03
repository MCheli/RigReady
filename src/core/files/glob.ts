/**
 * Small glob matcher for include/exclude patterns on relative paths.
 *
 *   *.lua            a file name at any depth (no slash in the pattern)
 *   Config/Input/**  everything below a folder
 *   Config/*.lua     directly inside a folder
 *   ?                one character
 *
 * Matching is case-insensitive (Windows) and uses forward slashes; backslashes in
 * patterns and paths are accepted.
 */
export function globToRegExp(pattern: string): RegExp {
  let glob = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (glob.endsWith('/')) glob += '**';
  if (!glob.includes('/')) glob = `**/${glob}`;
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

/** A reusable predicate for a set of include and exclude patterns. Exclude wins. */
export function createMatcher(
  include: string[] | undefined,
  exclude: string[] | undefined
): (relativePath: string) => boolean {
  const includes = (include ?? []).map(globToRegExp);
  const excludes = (exclude ?? []).map(globToRegExp);
  return (relativePath) => {
    const normalized = relativePath.replace(/\\/g, '/');
    if (excludes.some((re) => re.test(normalized))) return false;
    return includes.length === 0 || includes.some((re) => re.test(normalized));
  };
}
