import type { CommandShell, FeatureCommands } from '../../shared/feature';
import type { GameKind } from '../../shared/models';

/**
 * Keeps the shell's quiet accent on the kind of game the setup in use is for: flight or
 * racing. The shell does not know what a setup is; a feature that does says so from its
 * commands.ts (`setupKind`), and says when to ask again (`onSetupChanged`). Asked at once,
 * whenever such a feature says the setup may have changed, and whenever the machine did.
 * Returns the function that stops it.
 */
export function followSetupKind(
  modules: FeatureCommands[],
  shell: CommandShell,
  report: (kind: GameKind | undefined) => void,
  onMachineChanged: (listener: () => void) => () => void
): () => void {
  const knowing = modules.filter((module) => module.setupKind);
  let stopped = false;
  let asked = 0;

  async function ask(): Promise<void> {
    const mine = ++asked;
    let kind: GameKind | undefined;
    for (const module of knowing) {
      try {
        kind = await module.setupKind!(shell);
      } catch {
        // A feature that cannot say leaves the accent as the plain one: nothing depends on it.
        kind = undefined;
      }
      if (kind) break;
    }
    // An answer that was overtaken by a later question is not the state now.
    if (!stopped && mine === asked) report(kind);
  }

  const offs = [
    onMachineChanged(() => void ask()),
    ...modules
      .filter((module) => module.onSetupChanged)
      .map((module) => module.onSetupChanged!(shell, () => void ask())),
  ];
  void ask();
  return () => {
    stopped = true;
    for (const off of offs) off();
  };
}
