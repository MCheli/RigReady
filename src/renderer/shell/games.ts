import type { CommandShell, FeatureCommands, FoundGames } from '../../shared/feature';

/**
 * Keeps the shell told which games are found on this PC, so that the menu and the command
 * palette offer an entry or a page about a game only where the game is (the binding guide
 * where DCS is), as the Games page offers a game page's card. The shell does not know what
 * a game is; the feature that does says so from its commands.ts (`gamesFound`). Asked at
 * once and whenever the machine changed (a game folder chosen by hand, a game added).
 * Returns the function that stops it.
 *
 * `report` gets the ids found, or undefined when that could not be told (no feature knows,
 * or the one that does failed): then everything is offered, and each page says what it finds.
 */
export function followGamesFound(
  modules: FeatureCommands[],
  shell: CommandShell,
  report: (found: FoundGames) => void,
  onMachineChanged: (listener: () => void) => () => void
): () => void {
  const knowing = modules.find((module) => module.gamesFound);
  let stopped = false;
  let asked = 0;

  async function ask(): Promise<void> {
    const mine = ++asked;
    let found: FoundGames;
    try {
      found = knowing ? await knowing.gamesFound!(shell) : undefined;
    } catch {
      // The list of games could not be read (the Games page says why): nothing is held back.
      found = undefined;
    }
    // An answer that was overtaken by a later question is not the state now.
    if (!stopped && mine === asked) report(found);
  }

  const off = onMachineChanged(() => void ask());
  void ask();
  return () => {
    stopped = true;
    off();
  };
}
