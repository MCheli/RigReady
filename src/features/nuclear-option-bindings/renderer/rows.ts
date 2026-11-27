import type { Overview, OverviewBinding } from '../contract';

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

/** One place an action is bound: a device and the input on it, in the page's words. */
export interface ActionPlace {
  deviceId: string;
  deviceName: string;
  kind: 'controller' | 'keyboard' | 'mouse';
  connected: boolean;
  /** "Button 5", "Y axis · reversed", "Ctrl + E". */
  input: string;
}

export interface ActionRow {
  /** The binding id: "5", "25", "25:+". */
  key: string;
  name: string;
  category: string;
  places: ActionPlace[];
  /** How many controllers it is bound on: more than one is usually the game's own doing. */
  controllers: number;
}

/**
 * Every action the game has, bound or not, with every place it is bound across the devices.
 * A search leaves the actions whose name, group or any place has every word; "several" leaves
 * only the ones bound on more than one controller.
 */
export function actionRows(
  overview: Pick<Overview, 'actions' | 'devices'>,
  search: string | null,
  several = false
): ActionRow[] {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = overview.actions.map((action): ActionRow => {
    const places = overview.devices.flatMap((d) =>
      d.bindings
        .filter((b) => b.actionId === action.key)
        .map((b): ActionPlace => ({
          deviceId: d.id,
          deviceName: d.name,
          kind: d.kind,
          connected: d.connected,
          input: [...b.modifiers, b.inputLabel].join(' + ') + (b.inverted ? ' · reversed' : ''),
        }))
    );
    return {
      key: action.key,
      name: action.name,
      category: action.category,
      places,
      controllers: new Set(places.filter((p) => p.kind === 'controller').map((p) => p.deviceId))
        .size,
    };
  });
  return rows.filter((row) => {
    if (several && row.controllers < 2) return false;
    if (words.length === 0) return true;
    const text = [row.name, row.category, ...row.places.flatMap((p) => [p.deviceName, p.input])]
      .join(' ')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
