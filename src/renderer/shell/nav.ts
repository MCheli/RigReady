/**
 * Which entry of the side navigation the page on screen belongs to. A page one below an
 * entry (a setup's editor under Setups, the trainer under Cheat sheets) belongs to that
 * entry; where one entry lies below another (Wheel below Racing), the nearest one counts.
 * A page with no entry of its own that stands under one (`places`: the DCS World page under
 * Games, a game's bindings under Bindings) belongs to that entry, and so do the pages below
 * it; the nearest still counts, so Wheel stays Wheel inside the Racing page's address.
 */
export function currentEntry(
  entries: readonly string[],
  path: string,
  places: readonly { to: string; under: string }[] = []
): string | undefined {
  let nearest: { entry: string; length: number } | undefined;
  const consider = (to: string, entry: string): void => {
    if (path !== to && !path.startsWith(`${to}/`)) return;
    if (nearest === undefined || to.length > nearest.length) nearest = { entry, length: to.length };
  };
  for (const to of entries) consider(to, to);
  for (const place of places) consider(place.to, place.under);
  return nearest?.entry;
}

/**
 * What the entry says of itself to a screen reader: the page itself, the place the page is
 * in, or nothing.
 */
export function ariaCurrent(
  to: string,
  current: string | undefined,
  path: string
): 'page' | 'location' | undefined {
  if (to !== current) return undefined;
  return path === to ? 'page' : 'location';
}

/**
 * Where the window scrolls to after a move. A new page starts at its top, wherever the last
 * one was left. Going back or forward returns to where that page was. A change that keeps
 * the page's address (a chosen device, a tab the page keeps in its query) leaves the scroll
 * alone; a tab with an address of its own is a new page.
 */
export function scrollOnMove<P>(to: string, from: string, saved: P | null): P | { top: 0 } | false {
  return saved ?? (to === from ? false : { top: 0 });
}
