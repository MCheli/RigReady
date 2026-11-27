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
 * A binding the page can change or clear, in the game's own map category: a plain button of
 * the controller on a button action or on one side of an axis action, or a whole axis of the
 * controller on an axis action. `takes` says, by the binding's action id ("5", "25", "25:+"),
 * what each thing the page offers is bound to. Half an axis on one side of an action is not
 * one of them: its id is a side's, which takes a button.
 */
export function canChange(
  binding: OverviewBinding,
  takes: ReadonlyMap<string, 'button' | 'axis'>
): boolean {
  return (
    (binding.kind === 'button' || binding.kind === 'axis') &&
    binding.control?.kind === binding.kind &&
    binding.mapCategory === 'Game' &&
    binding.modifiers.length === 0 &&
    takes.get(binding.actionId) === binding.kind
  );
}
