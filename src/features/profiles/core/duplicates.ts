/**
 * Telling whether a checklist item or an action is already in a setup: same type and same
 * target (process name, device identity, file path, service, game). Pure, so the editor
 * uses it directly.
 */

const TARGET_KEYS = [
  'name',
  'vendorId',
  'productId',
  'serial',
  'instanceId',
  'path',
  'exe',
  'game',
  'id',
];

export interface Comparable {
  type: string;
  params: Record<string, unknown>;
}

export function targetOf(item: Comparable): string {
  const parts = TARGET_KEYS.filter((key) => item.params[key] !== undefined).map(
    (key) => `${key}=${String(item.params[key]).toLowerCase()}`
  );
  // Items with no recognisable target (a monitor layout) compare on all their params.
  return `${item.type}|${parts.length > 0 ? parts.join('|') : JSON.stringify(item.params)}`;
}

export function isDuplicate(candidate: Comparable, existing: Comparable[]): boolean {
  const key = targetOf(candidate);
  return existing.some((item) => targetOf(item) === key);
}

/** The next free id with a prefix: c1, c2, ... */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}
