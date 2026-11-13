import type { Action } from '../contract';

/**
 * Which actions the bindings page lists under its search and filters. Pure, so the rule
 * is tested without a window.
 */

export interface RowFilter {
  /** The search text: name, iRacing's id, the input or the device. */
  text: string;
  onlyUnbound: boolean;
  onlyDiffers: boolean;
  /** Device key to show the bindings of, or '' for all. */
  device: string;
}

const haystack = (a: Action): string =>
  `${a.name} ${a.id} ${a.binding?.input ?? 'not bound'} ${a.binding?.deviceName ?? ''}`.toLowerCase();

/**
 * The actions shown. `keep` is the action whose binding was just saved: it stays in the
 * list, with its new binding, even when the filters would now hide it ("Not bound" on and
 * it was just bound), so the user sees what they changed. The page lets go of it as soon
 * as the search or a filter changes.
 */
export function shownActions(actions: Action[], filter: RowFilter, keep?: string): Action[] {
  const q = filter.text.trim().toLowerCase();
  return actions.filter(
    (a) =>
      a.id === keep ||
      ((!q || haystack(a).includes(q)) &&
        (!filter.onlyUnbound || !a.binding) &&
        (!filter.onlyDiffers || a.differs) &&
        (!filter.device || a.binding?.device === filter.device))
  );
}
