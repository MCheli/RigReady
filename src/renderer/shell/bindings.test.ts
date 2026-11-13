import { describe, expect, it } from 'vitest';
import type { BindingsPage, CommandShell, FeatureCommands } from '../../shared/feature';
import {
  bindingsOffered,
  bindingsPageAt,
  bindingsTarget,
  chooseBindingsPage,
  setupGameOf,
  type BindingsMemory,
} from './bindings';

/** The two bindings pages the app has, as their manifests declare them. */
const DCS: BindingsPage = { game: 'dcs', name: 'DCS', to: '/configure/dcs-bindings', order: 10 };
const IRACING: BindingsPage = {
  game: 'iracing',
  name: 'iRacing',
  to: '/configure/iracing-bindings',
  order: 20,
};
const PAGES = [DCS, IRACING];
/** The owner's rig: both games found. */
const BOTH = ['dcs', 'iracing'];

function memory(start?: string): BindingsMemory & { saved: string[] } {
  let value = start;
  const saved: string[] = [];
  return {
    saved,
    read: () => value,
    write(game) {
      value = game;
      saved.push(game);
    },
  };
}

const shell = {} as CommandShell;

describe('NAV-GAMES-002 which game Bindings opens', () => {
  it('the game shown last, while it still has a page', () => {
    expect(chooseBindingsPage(PAGES, 'iracing', 'dcs')).toBe(IRACING);
    expect(chooseBindingsPage(PAGES, 'dcs', 'iracing')).toBe(DCS);
  });

  it('on first use the game of the setup in use, when it has a page', () => {
    expect(chooseBindingsPage(PAGES, undefined, 'iracing')).toBe(IRACING);
    expect(chooseBindingsPage(PAGES, undefined, 'dcs')).toBe(DCS);
  });

  it('otherwise the first game of the picker: no setup, a setup for a game without a page, a game that lost its page', () => {
    expect(chooseBindingsPage(PAGES, undefined, undefined)).toBe(DCS);
    expect(chooseBindingsPage(PAGES, undefined, 'msfs2024')).toBe(DCS);
    expect(chooseBindingsPage(PAGES, 'lmu', 'msfs2024')).toBe(DCS);
    expect(chooseBindingsPage(PAGES, 'lmu', 'iracing')).toBe(IRACING);
    expect(chooseBindingsPage([], 'dcs', 'dcs')).toBeUndefined();
  });

  it('asks about the setup only when no game has been shown yet', async () => {
    let asked = 0;
    const setupGame = async (): Promise<string> => {
      asked++;
      return 'iracing';
    };
    expect(await bindingsTarget(PAGES, memory('dcs'), setupGame, BOTH)).toBe(DCS);
    expect(asked).toBe(0);
    expect(await bindingsTarget(PAGES, memory(), setupGame, BOTH)).toBe(IRACING);
    expect(asked).toBe(1);
    // A remembered game that has no page any more counts as nothing remembered.
    expect(await bindingsTarget(PAGES, memory('lmu'), setupGame, BOTH)).toBe(IRACING);
    expect(asked).toBe(2);
  });

  it('opens only a game found on this PC, and nothing where none is', async () => {
    const noSetup = async (): Promise<undefined> => undefined;
    // A PC whose only game is iRacing, no setup, nothing chosen yet: iRacing, not DCS.
    expect(await bindingsTarget(PAGES, memory(), noSetup, ['iracing'])).toBe(IRACING);
    // DCS shown last, or the setup in use for DCS, on a PC where DCS is not found any more.
    expect(await bindingsTarget(PAGES, memory('dcs'), noSetup, ['iracing', 'acc'])).toBe(IRACING);
    expect(await bindingsTarget(PAGES, memory(), async () => 'dcs', ['iracing'])).toBe(IRACING);
    // No game with a bindings page found: Bindings says so (NoBindings), and opens no page.
    expect(await bindingsTarget(PAGES, memory('dcs'), async () => 'dcs', [])).toBeUndefined();
    expect(await bindingsTarget(PAGES, memory(), noSetup, ['acc', 'lmu'])).toBeUndefined();
    // When which games are here cannot be told, every game's page is offered, as before.
    expect(await bindingsTarget(PAGES, memory(), noSetup, undefined)).toBe(DCS);
  });

  it('the picker lists the games found, and the game on screen, which a link opens anywhere', () => {
    expect(bindingsOffered(PAGES, BOTH)).toEqual([DCS, IRACING]);
    expect(bindingsOffered(PAGES, ['iracing'])).toEqual([IRACING]);
    expect(bindingsOffered(PAGES, [])).toEqual([]);
    expect(bindingsOffered(PAGES, undefined)).toEqual([DCS, IRACING]);
    // DCS's bindings opened by a link on a PC with iRacing only: it says which game it is.
    expect(bindingsOffered(PAGES, ['iracing'], DCS)).toEqual([DCS, IRACING]);
    expect(bindingsOffered(PAGES, [], IRACING)).toEqual([IRACING]);
  });

  it('the page a path is on: the page itself and its tabs, never one that only begins the same', () => {
    expect(bindingsPageAt(PAGES, '/configure/dcs-bindings')).toBe(DCS);
    expect(bindingsPageAt(PAGES, '/configure/dcs-bindings/device-ids')).toBe(DCS);
    expect(bindingsPageAt(PAGES, '/configure/iracing-bindings')).toBe(IRACING);
    expect(bindingsPageAt(PAGES, '/configure/dcs')).toBeUndefined();
    expect(bindingsPageAt(PAGES, '/configure/dcs-bindingsx')).toBeUndefined();
    expect(bindingsPageAt(PAGES, '/configure/bindings')).toBeUndefined();
  });
});

describe('NAV-GAMES-002 the game of the setup in use', () => {
  it('comes from the first feature that knows', async () => {
    const modules: FeatureCommands[] = [
      { feature: 'backup' },
      { feature: 'quiet', setupGame: async () => undefined },
      { feature: 'fly', setupGame: async () => 'iracing' },
      { feature: 'later', setupGame: async () => 'dcs' },
    ];
    expect(await setupGameOf(modules, shell)).toBe('iracing');
  });

  it('a feature that fails is passed over; nobody knowing is undefined, never a throw', async () => {
    const broken: FeatureCommands = {
      feature: 'broken',
      setupGame: () => Promise.reject(new Error('The setups could not be read.')),
    };
    expect(await setupGameOf([broken], shell)).toBeUndefined();
    expect(
      await setupGameOf([broken, { feature: 'fly', setupGame: async () => 'dcs' }], shell)
    ).toBe('dcs');
    expect(await setupGameOf([], shell)).toBeUndefined();
  });
});
