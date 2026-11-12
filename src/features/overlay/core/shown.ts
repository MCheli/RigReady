import type { PressRow } from './model';
import type { At } from './settings';

/**
 * What a window draws of the recent presses, worked out without a window: which lines are
 * still alive by the window's own clock, when the next one is over, what each line says,
 * and which edge the list hangs from. The drawing (renderer/widgets/RecentPresses.vue)
 * only puts this on the screen.
 */

export interface ShownRow {
  row: PressRow;
  /** New whenever the control is pressed again, so that its fading starts over. */
  key: string;
  /** When it was pressed, by the clock of the window that draws it (milliseconds). */
  pressedAt: number;
  /** How far into its life it was when the window first had it: where its fading starts. */
  startAgeMs: number;
}

/**
 * The lines as they were sent, each with the moment it was pressed by the window's clock.
 * All of them are sent again with every press, each a little older than the last time; a
 * line the window already has keeps the moment it was given first, so it does not start
 * fading from the beginning again, or twice as fast.
 */
export function takeRows(
  had: readonly ShownRow[],
  rows: readonly PressRow[],
  now: number
): ShownRow[] {
  const known = new Map(had.map((shown) => [shown.key, shown]));
  return rows.map((row) => {
    const key = `${row.id}:${row.stamp}`;
    const kept = known.get(key);
    return kept
      ? { ...kept, row }
      : { row, key, pressedAt: now - row.ageMs, startAgeMs: row.ageMs };
  });
}

/** The lines whose time is not over. */
export function alive(shown: readonly ShownRow[], lifetimeMs: number, now: number): ShownRow[] {
  return shown.filter((line) => now - line.pressedAt < lifetimeMs);
}

/** How long until the first of them is over. Undefined when there is none to wait for. */
export function nextEnd(
  shown: readonly ShownRow[],
  lifetimeMs: number,
  now: number
): number | undefined {
  if (shown.length === 0) return undefined;
  const first = Math.min(...shown.map((line) => line.pressedAt + lifetimeMs));
  return Math.max(0, first - now);
}

/** What one line says. */
export interface RowWords {
  /** The large words: what the game does on the control. */
  main: string;
  /** What must be held with the control for that, when anything. */
  held: string[];
  /** How many more actions the game has on the same control. */
  more: number;
  /** The small words: the control and the controller. */
  sub: string;
  /** The game has nothing on it: drawn quietly, so a bound press stands out. */
  quiet: boolean;
}

export const NOT_BOUND = 'Not bound';

export function rowWords(row: PressRow): RowWords {
  const [first, ...rest] = row.actions;
  const where = `${row.control} · ${row.device}`;
  if (first) {
    return {
      main: first.action,
      held: first.modifiers,
      more: rest.length,
      sub: where,
      quiet: false,
    };
  }
  // The bindings were read and have nothing on it.
  if (row.known) return { main: NOT_BOUND, held: [], more: 0, sub: where, quiet: true };
  // The bindings could not be read: what is known is which control it was.
  return { main: row.control, held: [], more: 0, sub: row.device, quiet: false };
}

/**
 * Which edge of its window the list hangs from, by where the window is on the screen: the
 * newest line is always at that edge, and older ones go towards the middle of the screen.
 * A list low on the screen grows upwards, one in the right third is set to the right.
 */
export interface Anchor {
  edge: 'top' | 'bottom';
  side: 'left' | 'middle' | 'right';
}

export function anchorOf(at: At): Anchor {
  return {
    edge: at.y < 0.5 ? 'top' : 'bottom',
    side: at.x < 1 / 3 ? 'left' : at.x > 2 / 3 ? 'right' : 'middle',
  };
}

/** The nine places the page offers by name; anywhere else is reached by dragging. */
export const NAMED_PLACES: readonly { at: At; label: string }[] = [
  { at: { x: 0, y: 0 }, label: 'Top left' },
  { at: { x: 0.5, y: 0 }, label: 'Top middle' },
  { at: { x: 1, y: 0 }, label: 'Top right' },
  { at: { x: 0, y: 0.5 }, label: 'Middle left' },
  { at: { x: 0.5, y: 0.5 }, label: 'Middle' },
  { at: { x: 1, y: 0.5 }, label: 'Middle right' },
  { at: { x: 0, y: 1 }, label: 'Bottom left' },
  { at: { x: 0.5, y: 1 }, label: 'Bottom middle' },
  { at: { x: 1, y: 1 }, label: 'Bottom right' },
];

/** The name of the place a widget is at, when it is one of the nine. */
export function namedPlace(at: At): string | undefined {
  return NAMED_PLACES.find((place) => place.at.x === at.x && place.at.y === at.y)?.label;
}
