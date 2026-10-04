import { describe, expect, it } from 'vitest';
import {
  GROUP_SHOWN,
  moveActive,
  parseRecent,
  RECENT,
  RECENT_KEPT,
  RECENT_SHOWN,
  remember,
  RESULTS_SHOWN,
  searchCommands,
} from './palette';
import { GO_TO, sortCommands, type ListedCommand } from './registry';

const action = (id: string, title: string, group: string, groupOrder: number): ListedCommand => ({
  id,
  title,
  feature: id.split('.')[0]!,
  group,
  groupOrder,
  order: 0,
  kind: 'action',
  run: async () => undefined,
});
const page = (to: string, title: string, order: number, hint?: string): ListedCommand => ({
  id: `page:${to}`,
  title,
  feature: 'x',
  group: GO_TO,
  groupOrder: 1_000_000,
  order,
  kind: 'page',
  to,
  ...(hint ? { hint } : {}),
});

const COMMANDS = sortCommands([
  { ...page('/fly', 'Play', -1), keywords: ['fly', 'race', 'ready'] },
  page('/configure/profiles', 'Setups', 1),
  page('/configure/backups', 'Backups', 2),
  page('/configure/displays', 'Monitors', 3, 'Hardware'),
  page('/configure/devices', 'Devices', 4, 'Hardware'),
  page('/configure/devices/test', 'Input tester', 5, 'Devices'),
  action('fly.makeReady', 'Make ready', 'Play', -1),
  action('fly.launch', 'Launch', 'Play', -1),
  action('fly.standDown', 'Stand down', 'Play', -1),
  action('displays.identify', 'Identify monitors', 'Monitors', 30_410),
  action('displays.apply.flying', 'Apply layout: Flying', 'Monitors', 30_410),
  action('backup.now', 'Back up now', 'Backups', 120),
]);

const titles = (query: string, recent: string[] = []): string[] =>
  searchCommands(COMMANDS, query, recent).flatMap((s) => s.rows.map((r) => r.command.title));

describe('what the palette shows', () => {
  it('with nothing typed: every command under its heading, in the order the registry gave', () => {
    const sections = searchCommands(COMMANDS, '');
    expect(sections.map((s) => s.title)).toEqual(['Play', 'Backups', 'Monitors', GO_TO]);
    expect(sections[0]!.rows.map((r) => r.command.title)).toEqual([
      'Make ready',
      'Launch',
      'Stand down',
    ]);
    expect(sections[3]!.rows.map((r) => r.command.title)).toEqual([
      'Play',
      'Setups',
      'Backups',
      'Monitors',
      'Devices',
      'Input tester',
    ]);
    // Nothing is marked: nothing was typed.
    expect(sections.every((s) => s.rows.every((r) => r.positions.length === 0))).toBe(true);
  });

  it('with nothing typed: the commands used last come first, newest first, then the others', () => {
    const recent = ['backup.now', 'page:/configure/displays', 'gone.command', 'fly.launch'];
    const sections = searchCommands(COMMANDS, '   ', recent);
    expect(sections[0]!.title).toBe(RECENT);
    // A remembered command that no longer exists (a deleted layout) is left out.
    expect(sections[0]!.rows.map((r) => r.command.title)).toEqual([
      'Back up now',
      'Monitors',
      'Launch',
    ]);
    // Each command is listed once: what leads the list is not repeated under its heading,
    // and a heading with nothing left under it is not shown.
    expect(sections.slice(1).map((s) => s.title)).toEqual(['Play', 'Monitors', GO_TO]);
    expect(sections[1]!.rows.map((r) => r.command.title)).toEqual(['Make ready', 'Stand down']);
    const all = sections.flatMap((s) => s.rows.map((r) => r.command.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(COMMANDS.length);
    const many = COMMANDS.map((c) => c.id);
    expect(searchCommands(COMMANDS, '', many)[0]!.rows).toHaveLength(RECENT_SHOWN);
  });

  it('with something typed: one list, the best answer first', () => {
    expect(titles('mr')[0]).toBe('Make ready');
    expect(titles('launch')[0]).toBe('Launch');
    expect(titles('stand')[0]).toBe('Stand down');
    // The mode by its name, with the commands that stand under it; and by what is done there.
    expect(titles('play').slice(0, 4)).toEqual(['Play', 'Make ready', 'Launch', 'Stand down']);
    expect(titles('play launch')).toEqual(['Launch']);
    expect(titles('fly')).toContain('Play');
    expect(titles('race')).toEqual(['Play']);
    // The page called Monitors, then the commands under Monitors.
    expect(titles('monitors').slice(0, 3)).toEqual([
      'Monitors',
      'Identify monitors',
      'Apply layout: Flying',
    ]);
    expect(titles('back')).toEqual(['Backups', 'Back up now']);
    expect(titles('input')).toEqual(['Input tester']);
    expect(titles('hardware')).toEqual(['Monitors', 'Devices']);
    expect(titles('zzz')).toEqual([]);
    expect(searchCommands(COMMANDS, 'zzz')).toEqual([]);
    expect(searchCommands(COMMANDS, 'fly')[0]!.title).toBe('Results');
  });

  it('marks the letters that were found in the title', () => {
    const [first] = searchCommands(COMMANDS, 'mr')[0]!.rows;
    expect(first!.positions).toEqual([0, 5]);
  });

  it('puts a command used recently ahead in a near tie, never ahead of a clearly better answer', () => {
    // "b" starts both; without history the page comes first.
    expect(titles('ba')).toEqual(['Backups', 'Back up now']);
    expect(titles('ba', ['backup.now'])).toEqual(['Back up now', 'Backups']);
    // "launch" typed out is Launch, whatever was used last.
    expect(titles('launch', ['fly.makeReady', 'backup.now'])[0]).toBe('Launch');
  });

  it('never lists more than a screenful of matches, and leaves out the ones far weaker than the best', () => {
    const many = Array.from({ length: 80 }, (_, i) => page(`/p/${i}`, `Page ${i}`, i));
    expect(searchCommands(many, 'page')[0]!.rows).toHaveLength(RESULTS_SHOWN);
    // "mon" is Monitors; a title that only happens to hold an m and "on" is not offered beside it.
    const noisy = [...COMMANDS, page('/x', 'Stream Deck on a new PC', 99)];
    expect(searchCommands(noisy, 'mon')[0]!.rows.map((r) => r.command.title)).not.toContain(
      'Stream Deck on a new PC'
    );
    // With nothing better it is still found.
    expect(
      searchCommands([page('/x', 'Stream Deck on a new PC', 99)], 'mon')[0]!.rows
    ).toHaveLength(1);
  });

  it('with nothing typed, a heading with many commands shows the first few and counts the rest; pages are all shown', () => {
    const aircraft = Array.from({ length: GROUP_SHOWN + 3 }, (_, i) =>
      action(`dcs.a${i}`, `Bindings: Aircraft ${i}`, 'DCS bindings', 300)
    );
    const pages = Array.from({ length: 20 }, (_, i) => page(`/p/${i}`, `Page ${i}`, i));
    const sections = searchCommands(sortCommands([...aircraft, ...pages]), '');
    expect(sections[0]).toMatchObject({ title: 'DCS bindings', more: 3 });
    expect(sections[0]!.rows).toHaveLength(GROUP_SHOWN);
    expect(sections[1]!.title).toBe(GO_TO);
    expect(sections[1]!.rows).toHaveLength(20);
    expect(sections[1]!.more).toBeUndefined();
    // Typing finds the ones that were not shown.
    expect(
      searchCommands(sortCommands([...aircraft, ...pages]), `aircraft ${GROUP_SHOWN + 2}`)[0]!
        .rows[0]!.command.id
    ).toBe(`dcs.a${GROUP_SHOWN + 2}`);
  });
});

describe('recently used', () => {
  it('remembers the newest first, each once, and only so many', () => {
    expect(remember(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(remember([], 'a')).toEqual(['a']);
    const full = Array.from({ length: RECENT_KEPT }, (_, i) => `c${i}`);
    const next = remember(full, 'new');
    expect(next).toHaveLength(RECENT_KEPT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`c${RECENT_KEPT - 1}`);
  });

  it('reads back only what is a list of ids', () => {
    expect(parseRecent(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('')).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify(['a', 7, '', null, 'x'.repeat(300), 'b']))).toEqual([
      'a',
      'b',
    ]);
    expect(parseRecent(JSON.stringify(Array.from({ length: 50 }, (_, i) => `c${i}`)))).toHaveLength(
      RECENT_KEPT
    );
  });
});

describe('moving through the list', () => {
  it('goes round at both ends and starts at the end it is entered from', () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(1, 5, 3)).toBe(0);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
