import { describe, expect, it } from 'vitest';
import type { CommandShell, FeatureCommands } from '../../shared/feature';
import type { GameKind } from '../../shared/models';
import { followSetupKind } from './kind';

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

describe('the accent follows the kind of game the setup in use is for', () => {
  it('asks at once, again when the feature says the setup changed, and again when the machine did', async () => {
    let now: GameKind | undefined = 'flight';
    let changed: () => void = () => undefined;
    let stoppedWatching = 0;
    const fly: FeatureCommands = {
      feature: 'fly',
      setupKind: async () => now,
      onSetupChanged: (_shell, tell) => {
        changed = tell;
        return () => {
          stoppedWatching++;
        };
      },
    };
    const seen: (GameKind | undefined)[] = [];
    const pc = machine();
    const stop = followSetupKind([{ feature: 'backup' }, fly], shell, (k) => seen.push(k), pc.on);
    await settle();
    expect(seen).toEqual(['flight']);

    now = 'racing';
    changed();
    await settle();
    expect(seen).toEqual(['flight', 'racing']);

    // No setup in use any more: back to the plain accent.
    now = undefined;
    pc.change();
    await settle();
    expect(seen).toEqual(['flight', 'racing', undefined]);

    stop();
    expect(stoppedWatching).toBe(1);
    expect(pc.listening()).toBe(0);
    now = 'flight';
    changed();
    pc.change();
    await settle();
    expect(seen).toHaveLength(3);
  });

  it('an answer that a later question overtook is dropped', async () => {
    const answers: ((kind: GameKind | undefined) => void)[] = [];
    const slow: FeatureCommands = {
      feature: 'fly',
      setupKind: () => new Promise((resolve) => answers.push(resolve)),
    };
    const seen: (GameKind | undefined)[] = [];
    const pc = machine();
    followSetupKind([slow], shell, (k) => seen.push(k), pc.on);
    pc.change();
    await settle();
    expect(answers).toHaveLength(2);
    // The second question is answered first; the first answer arrives late and is stale.
    answers[1]!('racing');
    await settle();
    answers[0]!('flight');
    await settle();
    expect(seen).toEqual(['racing']);
  });

  it('a feature that cannot say leaves the plain accent, and the next one that knows is asked', async () => {
    const broken: FeatureCommands = {
      feature: 'a',
      setupKind: async () => {
        throw new Error('The setups could not be read.');
      },
    };
    const seen: (GameKind | undefined)[] = [];
    followSetupKind([broken], shell, (k) => seen.push(k), machine().on);
    await settle();
    expect(seen).toEqual([undefined]);

    const knows: FeatureCommands = { feature: 'b', setupKind: async () => 'racing' };
    followSetupKind([broken, knows], shell, (k) => seen.push(k), machine().on);
    await settle();
    expect(seen).toEqual([undefined, 'racing']);
  });

  it('with no feature that knows, the accent is the plain one', async () => {
    const seen: (GameKind | undefined)[] = [];
    followSetupKind([{ feature: 'backup' }], shell, (k) => seen.push(k), machine().on);
    await settle();
    expect(seen).toEqual([undefined]);
  });
});
