import type { OverviewBinding } from '../contract';

/** The bindings a search leaves: every word must be in the action, its group or the input. */
export function shownBindings(
  bindings: OverviewBinding[],
  search: string | null
): OverviewBinding[] {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return bindings;
  return bindings.filter((b) => {
    const text = [b.action, b.category, b.mapCategory, b.inputLabel, b.input, ...b.modifiers]
      .join(' ')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
