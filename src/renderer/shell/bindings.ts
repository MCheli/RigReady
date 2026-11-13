import {
  offeredFor,
  type BindingsPage,
  type CommandShell,
  type FeatureCommands,
  type FoundGames,
} from '../../shared/feature';

/**
 * The one Bindings entry of the menu and its game picker. Each feature that has a bindings
 * page says so in its manifest (`bindings`); the shell lists those pages of the games found
 * on this PC in the picker and opens one of them when Bindings is chosen, or says that no
 * such game was found. What is decided here is pure, so it is tested without a window; the
 * router and the picker only call it.
 */

/**
 * The bindings pages offered on this PC: those of the games found here (all of them when
 * that cannot be told), and the one on screen, which a link can open on any PC.
 */
export function bindingsOffered<P extends BindingsPage>(
  pages: readonly P[],
  found: FoundGames,
  shown?: P
): P[] {
  return pages.filter((page) => page === shown || offeredFor([page.game], found));
}

/** The game whose bindings were shown last: what Bindings opens next time. */
export const LAST_BINDINGS_KEY = 'rigready.bindings.game';

/** The bindings page a path is on (the page or one below it), if it is on one. */
export function bindingsPageAt<P extends BindingsPage>(
  pages: readonly P[],
  path: string
): P | undefined {
  return pages.find((page) => path === page.to || path.startsWith(`${page.to}/`));
}

/**
 * Which page Bindings opens: the game shown last while it still has a page; otherwise the
 * game of the setup in use, when it has one; otherwise the first in the picker.
 */
export function chooseBindingsPage<P extends BindingsPage>(
  pages: readonly P[],
  last: string | undefined,
  setupGame: string | undefined
): P | undefined {
  return (
    pages.find((page) => page.game === last) ??
    pages.find((page) => page.game === setupGame) ??
    pages[0]
  );
}

/** The game of the setup in use, from the first feature that can say. Never throws. */
export async function setupGameOf(
  modules: readonly FeatureCommands[],
  shell: CommandShell
): Promise<string | undefined> {
  for (const module of modules) {
    if (!module.setupGame) continue;
    try {
      const game = await module.setupGame(shell);
      if (game) return game;
    } catch {
      // A feature that cannot say leaves the choice to the picker's first game: Bindings
      // still opens, and the user can pick another.
    }
  }
  return undefined;
}

/** Where the game shown last is kept between starts of the app. */
export interface BindingsMemory {
  read(): string | undefined;
  write(game: string): void;
}

/** The window's own storage, where the palette keeps its recent commands too. */
export const windowMemory: BindingsMemory = {
  read() {
    try {
      return window.localStorage.getItem(LAST_BINDINGS_KEY) ?? undefined;
    } catch {
      // Storage is switched off for this window: Bindings opens on the setup's game.
      return undefined;
    }
  },
  write(game) {
    try {
      window.localStorage.setItem(LAST_BINDINGS_KEY, game);
    } catch {
      // Storage is full or switched off: the choice holds until the app is closed.
    }
  },
};

/**
 * The page Bindings opens now, among the games found on this PC (`found`); undefined when
 * none of them is. The setup in use is asked about only when no game has been shown yet (or
 * the one shown last has no page here any more), so a remembered choice opens at once.
 */
export async function bindingsTarget<P extends BindingsPage>(
  pages: readonly P[],
  memory: BindingsMemory,
  setupGame: () => Promise<string | undefined>,
  found: FoundGames
): Promise<P | undefined> {
  const here = bindingsOffered(pages, found);
  if (here.length === 0) return undefined;
  const last = memory.read();
  if (last !== undefined && here.some((page) => page.game === last)) {
    return chooseBindingsPage(here, last, undefined);
  }
  return chooseBindingsPage(here, undefined, await setupGame());
}
