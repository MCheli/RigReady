/**
 * RigReady 1 kept its setups in the same folder (`profiles/*.yaml`), in a format this
 * version does not read: no `schemaVersion`, and what a setup checked was a list called
 * `checklistItems`. Version 2 starts from scratch, and whoever used version 1 still has
 * those files.
 *
 * Such a file is not a damaged setup. It is left where it is, it is not counted among the
 * files that cannot be read (a first start would otherwise open on a warning instead of
 * the welcome), and the Setups page lists it apart with what it is.
 */
export function madeByVersionOne(raw: unknown): { name?: string } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const file = raw as Record<string, unknown>;
  // A file of this version, however broken, says which version of the format it is.
  if ('schemaVersion' in file || 'checks' in file) return undefined;
  if (!Array.isArray(file['checklistItems']) && !Array.isArray(file['trackedConfigurations'])) {
    return undefined;
  }
  const name = typeof file['name'] === 'string' ? file['name'].trim().slice(0, 120) : '';
  return name ? { name } : {};
}
