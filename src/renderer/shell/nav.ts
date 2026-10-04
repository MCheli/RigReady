/**
 * Which entry of the side navigation the page on screen belongs to. A page one below an
 * entry (a setup's editor under Setups, the trainer under Cheat sheets) belongs to that
 * entry; where one entry lies below another (Wheel below Racing), the nearest one counts.
 */
export function currentEntry(entries: readonly string[], path: string): string | undefined {
  let nearest: string | undefined;
  for (const to of entries) {
    if (path !== to && !path.startsWith(`${to}/`)) continue;
    if (nearest === undefined || to.length > nearest.length) nearest = to;
  }
  return nearest;
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
