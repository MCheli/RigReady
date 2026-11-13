import { describe, expect, it } from 'vitest';
import type { CommandShell, FeatureCommands, FoundGames } from '../../shared/feature';
import { followGamesFound } from './games';

const shell = {} as CommandShell;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A machine-changed signal the test can raise. */
function machine() {
  const listeners = new Set<() => void>();
  return {
    on: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change: () => listeners.forEach((listener) => listener()),
    listening: () => listeners.size,
  };
}

describe('NAV-GAMES-006 the shell follows the games found on this PC', () => {
  it('asks at once and again when the machine changed, until it is stopped', async () => {
    let now = ['iracing'];
    const games: FeatureCommands = { feature: 'games', gamesFound: async () => now };
    const seen: FoundGames[] = [];
    const pc = machine();
    const stop = followGamesFound(
      [{ feature: 'backup' }, games],
      shell,
      (f) => seen.push(f),
      pc.on
    );
    await settle();
    expect(seen).toEqual([['iracing']]);

    // DCS's folder chosen by hand on its game page: the machine changed.
    now = ['dcs', 'iracing'];
    pc.change();
    await settle();
    expect(seen).toEqual([['iracing'], ['dcs', 'iracing']]);

    stop();
    expect(pc.listening()).toBe(0);
    pc.change();
    await settle();
    expect(seen).toHaveLength(2);
  });

  it('an answer that a later question overtook is dropped', async () => {
    const answers: ((found: string[]) => void)[] = [];
    const slow: FeatureCommands = {
      feature: 'games',
      gamesFound: () => new Promise((resolve) => answers.push(resolve)),
    };
    const seen: FoundGames[] = [];
    const pc = machine();
    followGamesFound([slow], shell, (f) => seen.push(f), pc.on);
    pc.change();
    await settle();
    expect(answers).toHaveLength(2);
    answers[1]!([]);
    await settle();
    answers[0]!(['dcs']);
    await settle();
    expect(seen).toEqual([[]]);
  });

  it('when the games cannot be read, or no feature knows, it says it cannot tell', async () => {
    const broken: FeatureCommands = {
      feature: 'games',
      gamesFound: async () => {
        throw new Error('The games could not be listed.');
      },
    };
    const seen: FoundGames[] = [];
    followGamesFound([broken], shell, (f) => seen.push(f), machine().on);
    followGamesFound([{ feature: 'backup' }], shell, (f) => seen.push(f), machine().on);
    await settle();
    expect(seen).toEqual([undefined, undefined]);
  });
});
