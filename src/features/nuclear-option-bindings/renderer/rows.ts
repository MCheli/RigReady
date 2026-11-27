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
 * A binding the page can change or clear. On the keyboard, a key. On a controller, in the
 * game's own map category: a plain button of
 * the controller on a button action or on one side of an axis action, or a whole axis of the
 * controller on an axis action. `offered` says, by the binding's action id ("5", "25", "25:+"),
 * what each thing the page offers is bound to and which tab it is saved under. Half an axis on one side of an action is not
 * one of them: its id is a side's, which takes a button.
 */
export function canChange(
  binding: OverviewBinding,
  offered: ReadonlyMap<string, { takes: 'button' | 'axis'; mapCategory: string }>
): boolean {
  const entry = offered.get(binding.actionId);
  if (!entry) return false;
  // On the keyboard: a key RigReady knows the game's numbers for, with or without modifier
  // keys, on something that takes a button, in the tab that action's keys are saved under
  // (a change goes into that tab's map: a key found in another tab is not the one it edits).
  if (binding.kind === 'key') {
    return (
      binding.key !== undefined &&
      entry.takes === 'button' &&
      binding.mapCategory === entry.mapCategory
    );
  }
  return (
    (binding.kind === 'button' || binding.kind === 'axis') &&
    binding.control?.kind === binding.kind &&
    binding.mapCategory === 'Game' &&
    binding.modifiers.length === 0 &&
    entry.takes === binding.kind
  );
}
