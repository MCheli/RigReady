import { describe, expect, it } from 'vitest';
import {
  BINDINGS_ENTRY,
  bindingsPagesOf,
  gamePagesOf,
  gamesOfRoute,
  navEntriesOf,
  navSectionsOf,
  offeredFor,
  placesOf,
  SHELL_FEATURE,
  type FeatureManifest,
} from './feature';

/**
 * The menu from the manifests, as the features declare it since decision 1A (12 Nov 2026):
 * one Games entry with the pages about a game reached from it, and one Bindings entry with a
 * game picker. These manifests are the real ones' declarations, without their components.
 */
const games: FeatureManifest = {
  id: 'games',
  nav: [
    {
      title: 'Games',
      icon: 'mdi-gamepad-variant-outline',
      to: '/configure/games',
      order: 200,
      section: 'Games',
    },
  ],
};
const dcsSetup: FeatureManifest = {
  id: 'dcs-setup',
  gamePages: [
    {
      title: 'DCS World',
      icon: 'mdi-airplane',
      to: '/configure/dcs',
      about: 'Screens for the cockpit displays, Export.lua and SimAppPro.',
      games: ['dcs'],
      order: 210,
    },
  ],
};
const racing: FeatureManifest = {
  id: 'racing',
  nav: [
    {
      title: 'Wheel',
      icon: 'mdi-tire',
      to: '/configure/racing/wheel',
      order: 430,
      section: 'Hardware',
    },
  ],
  gamePages: [
    {
      title: 'Racing',
      icon: 'mdi-steering',
      to: '/configure/racing',
      about: 'Your wheel and the racing games: controllers, bindings and backups.',
      games: ['iracing', 'lmu', 'beamng', 'assetto-corsa'],
      order: 220,
    },
  ],
};
const dcsBindings: FeatureManifest = {
  id: 'dcs-bindings',
  bindings: [{ game: 'dcs', name: 'DCS', to: '/configure/dcs-bindings', order: 10 }],
};
const iracingBindings: FeatureManifest = {
  id: 'iracing-bindings',
  bindings: [{ game: 'iracing', name: 'iRacing', to: '/configure/iracing-bindings', order: 20 }],
};
const guide: FeatureManifest = {
  id: 'ai-assist',
  nav: [
    {
      title: 'Binding guide',
      icon: 'mdi-g',
      to: '/configure/ai-assist',
      order: 310,
      section: 'Controls',
      games: ['dcs'],
    },
  ],
};
const ALL = [dcsBindings, dcsSetup, games, guide, iracingBindings, racing];

const titles = (manifests: FeatureManifest[]) =>
  navSectionsOf(manifests).map((group) => [group.section, group.entries.map((e) => e.title)]);

describe('NAV-GAMES-001 one Games entry and one Bindings entry, whatever the games', () => {
  it('names no game: Games under Games, Bindings first under Controls', () => {
    expect(titles(ALL)).toEqual([
      ['Games', ['Games']],
      ['Controls', ['Bindings', 'Binding guide']],
      ['Hardware', ['Wheel']],
    ]);
    const words = navSectionsOf(ALL)
      .flatMap((group) => group.entries.map((e) => e.title))
      .join(' ');
    expect(words).not.toMatch(/DCS|iRacing|Racing\b/);
  });

  it('a game that gets a bindings page or a page of its own adds no entry', () => {
    const more: FeatureManifest = {
      id: 'lmu-bindings',
      bindings: [
        { game: 'lmu', name: 'Le Mans Ultimate', to: '/configure/lmu-bindings', order: 30 },
      ],
      gamePages: [
        {
          title: 'Le Mans Ultimate',
          icon: 'mdi-car',
          to: '/configure/lmu',
          about: 'Its own things.',
          games: ['lmu'],
          order: 230,
        },
      ],
    };
    expect(titles([...ALL, more])).toEqual(titles(ALL));
    expect(bindingsPagesOf([...ALL, more]).map((p) => p.name)).toEqual([
      'DCS',
      'iRacing',
      'Le Mans Ultimate',
    ]);
  });

  it('the Bindings entry is the shell’s, and only there while a feature has a bindings page', () => {
    expect(navSectionsOf(ALL).find((g) => g.section === 'Controls')!.entries[0]).toEqual(
      BINDINGS_ENTRY
    );
    expect(BINDINGS_ENTRY).toMatchObject({ title: 'Bindings', to: '/configure/bindings' });
    expect(titles([games, dcsSetup, guide])).toEqual([
      ['Games', ['Games']],
      ['Controls', ['Binding guide']],
    ]);
    // With one game on the list there is still the one entry.
    expect(titles([games, dcsBindings])).toEqual([
      ['Games', ['Games']],
      ['Controls', ['Bindings']],
    ]);
  });

  it('lists the pages in their own order, whatever the order of the folders', () => {
    expect(bindingsPagesOf([iracingBindings, dcsBindings]).map((p) => [p.game, p.feature])).toEqual(
      [
        ['dcs', 'dcs-bindings'],
        ['iracing', 'iracing-bindings'],
      ]
    );
    expect(gamePagesOf([racing, dcsSetup]).map((p) => p.title)).toEqual(['DCS World', 'Racing']);
  });
});

describe('NAV-GAMES-001 the pages that left the menu stand under an entry', () => {
  it('each game page under Games, each bindings page under Bindings, named as their entries were', () => {
    expect(
      placesOf(ALL).map((p) => [p.entry.title, p.entry.to, p.entry.section, p.under, p.feature])
    ).toEqual([
      [
        'DCS bindings',
        '/configure/dcs-bindings',
        'Controls',
        '/configure/bindings',
        'dcs-bindings',
      ],
      ['DCS World', '/configure/dcs', 'Games', '/configure/games', 'dcs-setup'],
      [
        'iRacing bindings',
        '/configure/iracing-bindings',
        'Controls',
        '/configure/bindings',
        'iracing-bindings',
      ],
      ['Racing', '/configure/racing', 'Games', '/configure/games', 'racing'],
    ]);
  });

  it('a bindings page stands after the Bindings entry and before the next one, in the picker’s order', () => {
    const order = (to: string) => placesOf(ALL).find((p) => p.entry.to === to)!.entry.order;
    expect(order('/configure/dcs-bindings')).toBeGreaterThan(BINDINGS_ENTRY.order);
    expect(order('/configure/iracing-bindings')).toBeGreaterThan(order('/configure/dcs-bindings'));
    expect(order('/configure/iracing-bindings')).toBeLessThan(310);
  });

  it('a game page with no Games entry to stand under is not placed', () => {
    expect(placesOf([dcsSetup]).map((p) => p.entry.to)).toEqual([]);
    expect(placesOf([dcsBindings]).map((p) => p.under)).toEqual([BINDINGS_ENTRY.to]);
  });

  it('the Bindings entry comes from the shell, every other entry from its feature', () => {
    expect(navEntriesOf(ALL).map(({ entry, feature }) => [entry.title, feature])).toEqual([
      ['Games', 'games'],
      ['Binding guide', 'ai-assist'],
      ['Wheel', 'racing'],
      ['Bindings', SHELL_FEATURE],
    ]);
  });
});

describe('NAV-GAMES-006 an entry or a page about a game is offered where the game is found', () => {
  const controls = (found: readonly string[] | undefined) =>
    navSectionsOf(ALL, found)
      .find((g) => g.section === 'Controls')!
      .entries.map((e) => e.title);

  it('the menu has the binding guide only on a PC with DCS', () => {
    expect(controls(['dcs'])).toEqual(['Bindings', 'Binding guide']);
    expect(controls(['dcs', 'iracing'])).toEqual(['Bindings', 'Binding guide']);
    expect(controls(['iracing'])).toEqual(['Bindings']);
    expect(controls([])).toEqual(['Bindings']);
    // An entry about no game in particular stays, whatever is found: Wheel, Games.
    expect(navSectionsOf(ALL, []).map((g) => g.entries.map((e) => e.title))).toEqual([
      ['Games'],
      ['Bindings'],
      ['Wheel'],
    ]);
  });

  it('when what is found could not be told, nothing is held back', () => {
    expect(controls(undefined)).toEqual(['Bindings', 'Binding guide']);
    expect(offeredFor(['dcs'], undefined)).toBe(true);
    expect(offeredFor(undefined, [])).toBe(true);
    expect(offeredFor([], [])).toBe(true);
    expect(offeredFor(['iracing', 'lmu'], ['lmu'])).toBe(true);
    expect(offeredFor(['dcs'], ['iracing'])).toBe(false);
  });

  it('a page is about the games of the nearest entry or page it lies in', () => {
    // The binding guide and its tabs.
    expect(gamesOfRoute(ALL, '/configure/ai-assist')).toEqual(['dcs']);
    expect(gamesOfRoute(ALL, '/configure/ai-assist/priorities')).toEqual(['dcs']);
    // A game page and the pages below it, with a query or not.
    expect(gamesOfRoute(ALL, '/configure/dcs')).toEqual(['dcs']);
    expect(gamesOfRoute(ALL, '/configure/dcs/screens')).toEqual(['dcs']);
    expect(gamesOfRoute(ALL, '/configure/racing/lmu')).toEqual([
      'iracing',
      'lmu',
      'beamng',
      'assetto-corsa',
    ]);
    // A bindings page is about its game, its tabs and an aircraft opened on it too.
    expect(gamesOfRoute(ALL, '/configure/dcs-bindings/devices')).toEqual(['dcs']);
    expect(gamesOfRoute(ALL, '/configure/dcs-bindings?aircraft=FA-18C_hornet')).toEqual(['dcs']);
    expect(gamesOfRoute(ALL, '/configure/iracing-bindings')).toEqual(['iracing']);
    // The Wheel entry lies inside the Racing page's address and is about no game.
    expect(gamesOfRoute(ALL, '/configure/racing/wheel')).toBeUndefined();
    // Neither are Games, Bindings, nor a page that only starts with the same letters.
    expect(gamesOfRoute(ALL, '/configure/games/dcs')).toBeUndefined();
    expect(gamesOfRoute(ALL, '/configure/bindings')).toBeUndefined();
    expect(gamesOfRoute(ALL, '/configure/dcs-setup')).toBeUndefined();
    expect(gamesOfRoute(ALL, '/fly')).toBeUndefined();
  });
});
