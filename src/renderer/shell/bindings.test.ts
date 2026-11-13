import { describe, expect, it } from 'vitest';
import type { BindingsPage, CommandShell, FeatureCommands } from '../../shared/feature';
import {
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
    expect(await bindingsTarget(PAGES, memory('dcs'), setupGame)).toBe(DCS);
    expect(asked).toBe(0);
    expect(await bindingsTarget(PAGES, memory(), setupGame)).toBe(IRACING);
    expect(asked).toBe(1);
    // A remembered game that has no page any more counts as nothing remembered.
    expect(await bindingsTarget(PAGES, memory('lmu'), setupGame)).toBe(IRACING);
    expect(asked).toBe(2);
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
