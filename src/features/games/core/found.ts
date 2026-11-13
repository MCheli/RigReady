import type { GameSummary } from '../contract';

/**
 * Whether a game was found on this PC: RigReady found an install of it. The Games page
 * lists such a game as found and offers the pages about it with a card; the shell offers an
 * entry or a page about a game in the menu and the command palette by the same rule (the
 * `gamesFound` of commands.ts).
 */
export const isFound = (game: Pick<GameSummary, 'installs'>): boolean => game.installs.length > 0;

/** The ids of the games found on this PC, in the order of the list. */
export const foundIds = (games: readonly Pick<GameSummary, 'id' | 'installs'>[]): string[] =>
  games.filter(isFound).map((game) => game.id);
