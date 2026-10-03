/**
 * Removes the Windows user name from paths inside text, and nothing else.
 * "C:\Users\Owner\Saved Games" -> "C:\Users\User\Saved Games" (also / and \\ forms).
 */
export function sanitizeUserPaths(text: string, userName: string, replacement = 'User'): string {
  if (!userName) return text;
  const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `((?:\\\\\\\\|\\\\|/)Users(?:\\\\\\\\|\\\\|/))${escaped}(?=\\\\|/|"|'|$|\\s)`,
    'gi'
  );
  return text.replace(pattern, `$1${replacement}`);
}

/** Applies sanitizeUserPaths to every string inside a JSON-like value. */
export function sanitizeDeep<T>(value: T, userName: string): T {
  if (typeof value === 'string') return sanitizeUserPaths(value, userName) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, userName)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v, userName)])
    ) as T;
  }
  return value;
}

/** The SteamID64 that stands for "no account" (account number 0). */
export const NEUTRAL_STEAM_ID = '76561197960265728';

/**
 * Removes account identifiers from recorded text: any SteamID64, and the player name
 * and nickname that Le Mans Ultimate stores in its settings.
 */
export function sanitizeIdentifiers(text: string): string {
  return text
    .replace(/\b7656119\d{10}\b/g, NEUTRAL_STEAM_ID)
    .replace(/("Player (?:Name|Nick)"\s*:\s*")[^"]*(")/g, '$1Player$2');
}
