import { matchCommand } from './fuzzy';
import { GO_TO, type ListedCommand } from './registry';

/**
 * What the command palette shows for what has been typed. Nothing typed: the commands used
 * last, then every other command under its heading. Something typed: the commands that
 * answer it, best first, with the ones used recently a little ahead. Pure: no DOM, no storage.
 */

export interface PaletteRow {
  command: ListedCommand;
  /** Places in the title where typed letters were found, for drawing them. */
  positions: number[];
}

export interface PaletteSection {
  title: string;
  rows: PaletteRow[];
  /** Commands under this heading that are not shown until something is typed. */
  more?: number;
}

export const RECENT = 'Recent';
/** How many recently used commands lead the list when nothing has been typed. */
export const RECENT_SHOWN = 5;
/** How many are remembered. */
export const RECENT_KEPT = 12;
/** A long list of weak matches helps nobody. */
export const RESULTS_SHOWN = 40;
/**
 * With nothing typed, a heading shows this many of its commands (one per aircraft or saved
 * layout can be many); the rest are found by typing. The pages are all shown: they are the
 * navigation.
 */
export const GROUP_SHOWN = 6;
/** With something typed, matches much weaker than the best one are left out. */
const WEAKEST = 0.6;
/** What having been used last adds to a match: enough to win a near tie, never a clear one. */
const RECENT_BONUS = 0.4;

export function searchCommands(
  commands: ListedCommand[],
  query: string,
  recent: string[] = []
): PaletteSection[] {
  const typed = query.trim();
  if (typed === '') {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const sections: PaletteSection[] = [];
    const lately = recent
      .map((id) => byId.get(id))
      .filter((c): c is ListedCommand => c !== undefined)
      .slice(0, RECENT_SHOWN);
    if (lately.length > 0) {
      sections.push({ title: RECENT, rows: lately.map((command) => ({ command, positions: [] })) });
    }
    // The rest in the order they were given: the registry has sorted headings and commands.
    // What already leads the list is not shown a second time under its heading.
    const shown = new Set(lately.map((command) => command.id));
    let heading: PaletteSection | undefined;
    for (const command of commands) {
      if (shown.has(command.id)) continue;
      if (!heading || heading.title !== command.group) {
        heading = { title: command.group, rows: [] };
        sections.push(heading);
      }
      if (command.group !== GO_TO && heading.rows.length >= GROUP_SHOWN) {
        heading.more = (heading.more ?? 0) + 1;
      } else heading.rows.push({ command, positions: [] });
    }
    return sections;
  }

  const found: (PaletteRow & { score: number; at: number })[] = [];
  commands.forEach((command, at) => {
    const match = matchCommand(typed, command);
    if (!match) return;
    const used = recent.indexOf(command.id);
    const bonus = used < 0 ? 0 : RECENT_BONUS * (1 - used / Math.max(recent.length, 1));
    found.push({ command, positions: match.positions, score: match.score + bonus, at });
  });
  found.sort((a, b) => b.score - a.score || a.at - b.at);
  // Measured against the best match without what it earned for being exact: typing the name
  // of a page must not hide the commands that stand under it.
  const letters = [...typed.replace(/\s+/g, '')].length;
  const floor = Math.min(found[0]?.score ?? 0, letters) * WEAKEST;
  const rows = found
    .filter((row) => row.score >= floor)
    .slice(0, RESULTS_SHOWN)
    .map(({ command, positions }) => ({ command, positions }));
  return rows.length > 0 ? [{ title: 'Results', rows }] : [];
}

/** The commands used last, newest first, after this one was used. */
export function remember(recent: string[], id: string): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_KEPT);
}

/** What was stored as the recently used commands, when it is a list of ids; else nothing. */
export function parseRecent(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
      .slice(0, RECENT_KEPT);
  } catch {
    // Not JSON: something else wrote this key. Starting with an empty list loses nothing that matters.
    return [];
  }
}

/** Moves the marked row by `step`, going round at the ends. -1 when there are no rows. */
export function moveActive(active: number, step: number, count: number): number {
  if (count <= 0) return -1;
  if (active < 0) return step > 0 ? 0 : count - 1;
  return (((active + step) % count) + count) % count;
}
