import { isBuiltin } from './builtins';
import type { PadProfile } from './profile';

/**
 * Profile names. No two profiles get the same name any more: two rows that read the same
 * are how the wrong one was deleted on 12 November 2026. A copy gets the next free
 * number, a new name that is taken is refused, and profiles that already share a name
 * (from before this rule) are shown with their ids.
 */

/** Two names are one name when only capitals or spacing differ: a person reads them as one. */
export const nameKey = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** What the editor and a refused save say about a name that is taken. */
export const nameTakenText = (other: Pick<PadProfile, 'id' | 'name'>): string =>
  `${isBuiltin(other.id) ? 'A starting point' : 'Another profile'} is already called "${other.name}". Give this one a different name.`;

const NAME_MAX = 80;

/**
 * The name as asked, or with the next free number after it when it is taken: "My HOTAS",
 * then "My HOTAS 2", "My HOTAS 3". A name that is itself such a numbered copy ("My HOTAS 2",
 * with "My HOTAS" there too) counts on from its number. Any other number at the end is
 * part of the name: a taken "Ace Combat 8" becomes "Ace Combat 8 2", never "Ace Combat 9".
 */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  const wanted = name.trim().replace(/\s+/g, ' ');
  if (!used.has(nameKey(wanted))) return wanted;
  const ending = /^(.*\S) (\d{1,4})$/.exec(wanted);
  const numbered = ending && used.has(nameKey(ending[1]!)) ? ending : undefined;
  const stem = numbered ? numbered[1]! : wanted;
  for (let n = numbered ? Number(numbered[2]) + 1 : 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${stem.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/**
 * What to call each profile where only a name is shown (the tray, the command palette): its
 * name, with its id after it when another profile has the same name.
 */
export function distinctLabels(
  profiles: readonly Pick<PadProfile, 'id' | 'name'>[]
): { id: string; name: string }[] {
  const count = new Map<string, number>();
  for (const p of profiles) count.set(nameKey(p.name), (count.get(nameKey(p.name)) ?? 0) + 1);
  return profiles.map((p) => ({
    id: p.id,
    name: (count.get(nameKey(p.name)) ?? 0) > 1 ? `${p.name} (${p.id})` : p.name,
  }));
}
