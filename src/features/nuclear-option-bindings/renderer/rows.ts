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
  /**
   * How many controllers drive the game's action this row belongs to: for an axis action,
   * its axis and its sides together ("Brake Axis" on the pedals and "Apply Brakes" on the
   * throttle are two). More than one is usually the game's own doing.
   */
  controllers: number;
  /** The count takes in other rows of the same action (its axis, its sides). */
  withFamily: boolean;
}

/** The game's action a binding id belongs to: "25" for "25", "25:+" and "25:-". */
const familyOf = (key: string): string => key.split(':')[0]!;

/** How many of the game's actions the list holds, an axis with its sides counted once. */
export const gameActionCount = (rows: ActionRow[]): number =>
  new Set(rows.map((row) => familyOf(row.key))).size;

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
  // What is bound to an action RigReady has no name for (a game update's) is listed too,
  // under the name its bindings carry.
  const known = new Set(overview.actions.map((a) => a.key));
  const unknown = new Map<string, { key: string; name: string; category: string }>();
  for (const d of overview.devices) {
    for (const b of d.bindings) {
      if (!known.has(b.actionId) && !unknown.has(b.actionId)) {
        unknown.set(b.actionId, { key: b.actionId, name: b.action, category: b.category });
      }
    }
  }
  // The controllers that drive each of the game's actions, in any form.
  const drivers = new Map<string, Set<string>>();
  for (const d of overview.devices) {
    if (d.kind !== 'controller') continue;
    for (const b of d.bindings) {
      const family = familyOf(b.actionId);
      drivers.set(family, (drivers.get(family) ?? new Set()).add(d.id));
    }
  }
  const rows = [...overview.actions, ...unknown.values()].map((action): ActionRow => {
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
      controllers: drivers.get(familyOf(action.key))?.size ?? 0,
      withFamily:
        (drivers.get(familyOf(action.key))?.size ?? 0) >
        new Set(places.filter((p) => p.kind === 'controller').map((p) => p.deviceId)).size,
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
