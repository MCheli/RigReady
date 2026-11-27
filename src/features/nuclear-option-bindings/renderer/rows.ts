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

/**
 * A binding the page can change or clear: a plain button of the controller, in the game's own
 * map category, on an action a button can be bound to (not one side of an axis).
 */
export function canChange(binding: OverviewBinding, buttonActions: ReadonlySet<number>): boolean {
  return (
    binding.kind === 'button' &&
    binding.control?.kind === 'button' &&
    binding.mapCategory === 'Game' &&
    binding.modifiers.length === 0 &&
    buttonActions.has(Number(binding.actionId))
  );
}
