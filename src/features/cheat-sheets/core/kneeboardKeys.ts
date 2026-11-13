import type { BoundAction, BoundDevice } from '../../../core/bindings';

/**
 * The keys a kneeboard needs. Pages on the kneeboard are of use only when the kneeboard can
 * be opened and its pages turned from where the hands are: a game binds these to the
 * keyboard by default and to nothing on a stick or throttle, and somebody who binds
 * "show the kneeboard" to a button finds out in the cockpit that the pages do not turn.
 */
export type KneeboardKey = 'show' | 'next' | 'previous';

export interface KneeboardKeyState {
  key: KneeboardKey;
  /** The game's own name for the action, to find it by: "Kneeboard Next Page". Absent when the aircraft has none. */
  action?: string;
  /** Where it is bound now, controllers first: "Button 12 on Throttle", "] on the keyboard". */
  bound: string[];
  /** True when one of those is on a controller. */
  onController: boolean;
}

export interface KneeboardKeys {
  keys: KneeboardKeyState[];
  /**
   * What the user should know about turning the pages, or absent when both page keys are
   * on a controller: the pages turn only from the keyboard, or from nothing at all.
   */
  pages?: 'keyboard' | 'unbound';
}

/**
 * Which key an action is, from the game's name for it. A glance view, a mark point and the
 * shortcuts ("Kneeboard Next Shortcut" jumps between marked pages; it does not turn one)
 * are none of them.
 */
export function kneeboardKeyOf(name: string): KneeboardKey | undefined {
  if (!/kneeboard/i.test(name)) return undefined;
  if (/glance|mark|shortcut/i.test(name)) return undefined;
  if (/\bpage\b/i.test(name)) {
    if (/\bnext\b/i.test(name)) return 'next';
    if (/\bprev(ious)?\b/i.test(name)) return 'previous';
    return undefined;
  }
  if (/\bon\s*\/\s*off\b|\bshow\b|\bhide\b|\btoggle\b/i.test(name)) return 'show';
  return undefined;
}

const ORDER: KneeboardKey[] = ['show', 'next', 'previous'];

/**
 * The three kneeboard keys of one aircraft and where each is bound, from its bindings as
 * they are in effect (defaults included) and, when the game can list them, every action it
 * has (so a key that is bound to nothing is still named).
 */
export function kneeboardKeys(devices: BoundDevice[], actions?: BoundAction[]): KneeboardKeys {
  const names = new Map<KneeboardKey, string>();
  const ids = new Map<string, KneeboardKey>();
  const know = (id: string, name: string): void => {
    const key = kneeboardKeyOf(name);
    if (!key) return;
    ids.set(id, key);
    if (!names.has(key)) names.set(key, name);
  };
  for (const action of actions ?? []) know(action.id, action.name);
  for (const device of devices) {
    for (const binding of device.bindings) know(binding.actionId, binding.action);
  }

  const bound = new Map<KneeboardKey, { text: string; controller: boolean }[]>();
  // Controllers first: that is where the hands are.
  const ordered = [...devices].sort(
    (a, b) => Number(b.kind === 'controller') - Number(a.kind === 'controller')
  );
  for (const device of ordered) {
    const where =
      device.kind === 'keyboard'
        ? 'the keyboard'
        : device.kind === 'mouse'
          ? 'the mouse'
          : (device.givenName ?? device.name);
    for (const binding of device.bindings) {
      const key = ids.get(binding.actionId);
      if (!key) continue;
      const text = `${[...binding.modifiers, binding.inputLabel].join(' + ')} on ${where}`;
      const list = bound.get(key) ?? [];
      if (!list.some((b) => b.text === text)) {
        list.push({ text, controller: device.kind === 'controller' });
      }
      bound.set(key, list);
    }
  }

  const keys = ORDER.map((key): KneeboardKeyState => {
    const list = bound.get(key) ?? [];
    const action = names.get(key);
    return {
      key,
      ...(action ? { action } : {}),
      bound: list.map((b) => b.text),
      onController: list.some((b) => b.controller),
    };
  });
  const pageKeys = keys.filter((k) => k.key !== 'show');
  // An aircraft without the actions at all has nothing to bind: nothing to say.
  const known = pageKeys.filter((k) => k.action !== undefined);
  if (known.length === 0 || known.every((k) => k.onController)) return { keys };
  return { keys, pages: known.some((k) => k.bound.length === 0) ? 'unbound' : 'keyboard' };
}
