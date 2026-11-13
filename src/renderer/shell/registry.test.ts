import { describe, expect, it } from 'vitest';
import {
  MODE_NAMES,
  type CommandShell,
  type FeatureCommands,
  type FeatureManifest,
  type PaletteCommand,
} from '../../shared/feature';
import {
  areaOf,
  GO_TO,
  humanize,
  listDynamic,
  listed,
  pageCommands,
  staticCommands,
} from './registry';

const blank = { render: () => null };

const MANIFESTS: FeatureManifest[] = [
  {
    // The feature behind Play mode: the folder and its routes keep the name they had.
    id: 'fly',
    routes: [
      { path: '/fly', component: blank, meta: { mode: 'fly', title: 'Fly' } },
      { path: '/fly/compact', component: blank, meta: { mode: 'fly', title: 'Compact view' } },
    ],
  },
  {
    id: 'profiles',
    nav: [
      { title: 'Setups', icon: 'mdi-a', to: '/configure/profiles', order: 100, section: 'Setups' },
    ],
    routes: [
      { path: '/configure/profiles', component: blank },
      { path: '/configure/profiles/capture', component: blank },
      { path: '/configure/profiles/:id', component: blank },
    ],
  },
  {
    id: 'devices',
    nav: [
      {
        title: 'Devices',
        icon: 'mdi-d',
        to: '/configure/devices',
        order: 400,
        section: 'Hardware',
      },
    ],
    routes: [
      {
        path: '/configure/devices',
        component: blank,
        children: [
          { path: '', component: blank },
          { path: 'test', component: blank },
          { path: 'usb', component: blank },
        ],
      },
    ],
  },
  {
    id: 'dcs-bindings',
    nav: [
      {
        title: 'DCS bindings',
        icon: 'mdi-b',
        to: '/configure/dcs-bindings',
        order: 300,
        section: 'Controls',
      },
    ],
    // An optional parameter: the page opens without it.
    routes: [{ path: '/configure/dcs-bindings/:tab?', component: blank }],
  },
  {
    id: 'racing',
    nav: [
      {
        title: 'Wheel',
        icon: 'mdi-w',
        to: '/configure/racing/wheel',
        order: 430,
        section: 'Hardware',
      },
      { title: 'Racing', icon: 'mdi-r', to: '/configure/racing', order: 220, section: 'Games' },
    ],
    routes: [
      { path: '/configure/racing', component: blank },
      { path: '/configure/racing/assetto-corsa', component: blank },
      { path: '/configure/racing/wheel', component: blank },
    ],
  },
  // No screen at all.
  { id: 'processes' },
  // A page in the navigation, and a window of its own that is not a place to go.
  {
    id: 'overlay',
    nav: [
      {
        title: 'Overlay',
        icon: 'mdi-o',
        to: '/configure/overlay',
        order: 330,
        section: 'Controls',
      },
    ],
    routes: [
      { path: '/configure/overlay', component: blank },
      { path: '/overlay/window', component: blank, meta: { bare: true, title: 'Window' } },
    ],
  },
];

/** A page of Configure that is in no menu, as a feature has before it gets its place there. */
const ABOUT: FeatureManifest = {
  id: 'about',
  routes: [{ path: '/configure/about', component: blank, meta: { title: 'About this PC' } }],
};

const shell = {} as CommandShell;
const run = async (): Promise<void> => undefined;

describe('pages for the palette, from the manifests alone', () => {
  const pages = pageCommands(MANIFESTS);
  const byRoute = (to: string) => pages.find((p) => p.to === to);

  it('lists every navigation entry under its own name, with its section as the hint', () => {
    expect(byRoute('/configure/profiles')).toMatchObject({
      id: 'page:/configure/profiles',
      title: 'Setups',
      hint: 'Setups',
      icon: 'mdi-a',
      group: GO_TO,
      kind: 'page',
      feature: 'profiles',
    });
    expect(byRoute('/configure/racing/wheel')).toMatchObject({ title: 'Wheel', hint: 'Hardware' });
  });

  it('lists the pages reached from inside others, named after the page they belong to', () => {
    expect(byRoute('/configure/profiles/capture')).toMatchObject({
      title: 'Setups: Capture',
      hint: 'Setups',
      icon: 'mdi-a',
    });
    expect(byRoute('/configure/devices/test')).toMatchObject({ title: 'Devices: Test' });
    expect(byRoute('/configure/devices/usb')).toMatchObject({ title: 'Devices: Usb' });
    expect(byRoute('/configure/racing/assetto-corsa')).toMatchObject({
      title: 'Racing: Assetto corsa',
      hint: 'Racing',
    });
  });

  it('the page the mode switch opens is called what the switch calls it: Play', () => {
    // Whatever its feature calls the route, and found by what is done there.
    const play = byRoute('/fly')!;
    expect(play).toMatchObject({
      id: 'page:/fly',
      title: MODE_NAMES.fly,
      hint: 'Is the rig ready, fix what is not, launch',
      feature: 'fly',
      group: GO_TO,
    });
    expect(play.title).toBe('Play');
    expect(play.keywords).toEqual(expect.arrayContaining(['fly', 'race']));
    // Nothing about it says flying to someone who only races.
    expect(`${play.title} ${play.hint} ${play.icon}`).not.toMatch(/fly|flight|airplane/i);
    // Another page of that mode keeps the title its route has, and says where it belongs.
    expect(byRoute('/fly/compact')).toMatchObject({
      title: 'Compact view',
      hint: 'Play',
      icon: play.icon,
    });
    expect(byRoute('/fly/compact')!.keywords).toBeUndefined();
  });

  it('leaves out what a link cannot open: a route with a required parameter', () => {
    expect(pages.some((p) => p.to?.includes(':'))).toBe(false);
    // The optional tab is dropped, and the page is there once, as the navigation entry.
    expect(pages.filter((p) => p.to === '/configure/dcs-bindings')).toHaveLength(1);
    // A layout and its first child are one page.
    expect(pages.filter((p) => p.to === '/configure/devices')).toHaveLength(1);
  });

  it('leaves out a bare page: a window of its own is opened by the app, not gone to', () => {
    expect(byRoute('/configure/overlay')).toMatchObject({ title: 'Overlay' });
    expect(byRoute('/overlay/window')).toBeUndefined();
  });

  it('orders them as the navigation does, each sub-page right after its page, Play first', () => {
    expect(pages.map((p) => p.to)).toEqual([
      '/fly',
      '/fly/compact',
      '/configure/profiles',
      '/configure/profiles/capture',
      '/configure/racing',
      '/configure/racing/assetto-corsa',
      '/configure/dcs-bindings',
      '/configure/overlay',
      '/configure/devices',
      '/configure/devices/test',
      '/configure/devices/usb',
      '/configure/racing/wheel',
    ]);
  });

  it('turns a route segment into words', () => {
    expect(humanize('assetto-corsa')).toBe('Assetto corsa');
    expect(humanize('usb')).toBe('Usb');
    expect(humanize('device_ids')).toBe('Device ids');
  });
});

describe('where a feature’s commands stand', () => {
  it('under the title of its first navigation entry, in navigation order', () => {
    const racing = MANIFESTS.find((m) => m.id === 'racing');
    expect(areaOf(racing, 'racing')).toMatchObject({ title: 'Racing', icon: 'mdi-r' });
    const devices = MANIFESTS.find((m) => m.id === 'devices');
    expect(areaOf(racing, 'racing').order).toBeLessThan(areaOf(devices, 'devices').order);
  });

  it('a feature without a navigation entry stands after the ones that have one, under its route’s title or its own name', () => {
    expect(areaOf(ABOUT, 'about')).toMatchObject({ title: 'About this PC' });
    expect(areaOf(undefined, 'checks-generic')).toMatchObject({ title: 'Checks generic' });
    const last = Math.max(...MANIFESTS.filter((m) => m.nav).map((m) => areaOf(m, m.id).order));
    expect(areaOf(ABOUT, 'about').order).toBeGreaterThan(last);
    expect(areaOf(undefined, 'checks-generic').order).toBeGreaterThan(last);
  });

  it('the feature whose pages are those of Play mode stands under the mode’s name', () => {
    expect(areaOf(MANIFESTS[0], 'fly')).toMatchObject({ title: 'Play', order: -1 });
  });

  it('an action stands under its feature; a page goes with the pages unless it names a heading', () => {
    const devices = MANIFESTS.find((m) => m.id === 'devices');
    expect(
      listed({ id: 'devices.find', title: 'Find a device', run }, 'devices', devices, 0)
    ).toMatchObject({ group: 'Devices', kind: 'action', icon: 'mdi-d' });
    expect(
      listed(
        { id: 'devices.t', title: 'Input tester', to: '/configure/devices/test' },
        'devices',
        devices,
        1
      )
    ).toMatchObject({ group: GO_TO, kind: 'page', hint: 'Devices' });
    // Its own icon and hint are kept; a title that already names the page gets no hint.
    expect(
      listed(
        { id: 'devices.x', title: 'Devices: Extra', icon: 'mdi-own', to: '/configure/devices?x=1' },
        'devices',
        devices,
        2
      )
    ).toMatchObject({ icon: 'mdi-own' });
    expect(
      listed(
        { id: 'devices.x', title: 'Devices: Extra', to: '/configure/devices?x=1' },
        'devices',
        devices,
        2
      ).hint
    ).toBeUndefined();
    expect(
      listed(
        {
          id: 'devices.a',
          title: 'Open the stick',
          to: '/configure/devices?select=1',
          group: 'Devices',
        },
        'devices',
        devices,
        3
      )
    ).toMatchObject({ group: 'Devices', kind: 'page' });
  });
});

describe('pages and commands together', () => {
  const modules: FeatureCommands[] = [
    {
      feature: 'devices',
      commands: [
        { id: 'devices.find', title: 'Find a device', run },
        {
          id: 'devices.tester',
          title: 'Input tester',
          icon: 'mdi-t',
          to: '/configure/devices/test',
        },
        { id: 'devices.page', title: 'Controllers', keywords: ['hotas'], to: '/configure/devices' },
        { id: 'devices.tab', title: 'Devices: Health', to: '/configure/devices?tab=health' },
      ],
    },
    { feature: 'fly', commands: [{ id: 'fly.recheck', title: 'Re-check', run }] },
  ];
  const all = staticCommands(MANIFESTS, modules);
  const byRoute = (to: string) => all.filter((c) => c.to === to);

  it('a feature’s name for one of its pages replaces the one made from the route', () => {
    expect(byRoute('/configure/devices/test')).toHaveLength(1);
    expect(byRoute('/configure/devices/test')[0]).toMatchObject({
      id: 'devices.tester',
      title: 'Input tester',
      icon: 'mdi-t',
      group: GO_TO,
    });
    // Still right after its page, where the route was.
    const routes = all.filter((c) => c.group === GO_TO).map((c) => c.to);
    expect(routes.indexOf('/configure/devices/test')).toBe(
      routes.indexOf('/configure/devices') + 1
    );
    // The route nobody named keeps the made-up name.
    expect(byRoute('/configure/devices/usb')[0]).toMatchObject({ title: 'Devices: Usb' });
  });

  it('a navigation entry keeps its name; the feature’s words are words it is found by', () => {
    expect(byRoute('/configure/devices')).toHaveLength(1);
    expect(byRoute('/configure/devices')[0]).toMatchObject({
      id: 'page:/configure/devices',
      title: 'Devices',
      keywords: ['Controllers', 'hotas'],
    });
  });

  it('a link with a query is a page of its own', () => {
    expect(byRoute('/configure/devices?tab=health')).toHaveLength(1);
  });

  it('headings come in navigation order with Play first and the pages last', () => {
    const groups = [...new Set(all.map((c) => c.group))];
    expect(groups).toEqual(['Play', 'Devices', GO_TO]);
    expect(all.find((c) => c.id === 'fly.recheck')).toMatchObject({
      group: 'Play',
      kind: 'action',
    });
  });

  it('only Play comes first: a feature without a navigation entry cannot stand before it', () => {
    // Whatever such a feature contributes: an action, a page under a heading of its own
    // (one that sorts before "Play"), a page among the pages.
    const more: FeatureCommands[] = [
      {
        feature: 'about',
        commands: [
          { id: 'about.copy', title: 'Copy the version', run },
          { id: 'about.open', title: 'About this PC', group: 'About', to: '/configure/about' },
          { id: 'about.licences', title: 'Licences', to: '/configure/about?tab=licences' },
        ],
      },
      ...modules,
    ];
    const withAbout = staticCommands([ABOUT, ...MANIFESTS], more);
    expect(withAbout[0]).toMatchObject({ id: 'fly.recheck', group: 'Play' });
    expect([...new Set(withAbout.map((c) => c.group))]).toEqual([
      'Play',
      'Devices',
      'About',
      'About this PC',
      GO_TO,
    ]);
    // Its pages come after the pages of the navigation, and Play's pages still lead.
    const routes = withAbout.filter((c) => c.group === GO_TO).map((c) => c.to);
    expect(routes.slice(0, 2)).toEqual(['/fly', '/fly/compact']);
    expect(routes.at(-1)).toBe('/configure/about?tab=licences');

    // The same for a page that has no command: from the manifest alone it goes last.
    expect(pageCommands([ABOUT, ...MANIFESTS]).map((p) => p.to)).toEqual([
      ...pageCommands(MANIFESTS).map((p) => p.to),
      '/configure/about',
    ]);
  });

  it('works with no command modules at all: the pages are still there', () => {
    expect(staticCommands(MANIFESTS, []).map((c) => c.id)).toEqual(
      pageCommands(MANIFESTS).map((c) => c.id)
    );
  });
});

describe('commands that depend on the machine', () => {
  const devices = MANIFESTS.find((m) => m.id === 'devices');

  it('are listed under the feature, after its fixed commands, in the order it gave', async () => {
    const listing = await listDynamic(
      {
        feature: 'devices',
        list: async () => [
          { id: 'devices.open.a', title: 'Open A', run },
          { id: 'devices.open.b', title: 'Open B', run },
        ],
      },
      devices,
      shell
    );
    expect(listing.problem).toBeUndefined();
    expect(listing.commands.map((c) => [c.title, c.group, c.order])).toEqual([
      ['Open A', 'Devices', 1000],
      ['Open B', 'Devices', 1001],
    ]);
  });

  it('a feature with nothing to list gives nothing, without being asked', async () => {
    expect(await listDynamic({ feature: 'devices' }, devices, shell)).toEqual({
      feature: 'devices',
      commands: [],
    });
  });

  it('a feature that fails is left out and says why; it never throws', async () => {
    const thrown = await listDynamic(
      {
        feature: 'devices',
        list: async () => {
          throw new Error('The device list could not be read.');
        },
      },
      devices,
      shell
    );
    expect(thrown).toEqual({
      feature: 'devices',
      commands: [],
      problem: 'The device list could not be read.',
    });
    const text = await listDynamic(
      { feature: 'devices', list: () => Promise.reject('plain text') },
      devices,
      shell
    );
    expect(text.problem).toBe('plain text');
  });

  it('a command that does nothing, belongs to another feature or repeats an id is left out and named', async () => {
    const bad: PaletteCommand[] = [
      { id: 'devices.good', title: 'Good', run },
      { id: 'devices.stub', title: 'Does nothing' },
      { id: 'other.thing', title: 'Not mine', run },
      { id: 'devices.good', title: 'Again', run },
    ];
    const listing = await listDynamic(
      { feature: 'devices', list: async () => bad },
      devices,
      shell
    );
    expect(listing.commands.map((c) => c.title)).toEqual(['Good']);
    expect(listing.problem).toBe(
      '"Does nothing": it must either open a page (to) or do something (run)'
    );
  });
});

describe('NAV-GAMES-003 the palette after the menu stopped naming games', () => {
  // The declarations of the real manifests since decision 1A, without their components.
  const MENU: FeatureManifest[] = [
    MANIFESTS[0]!,
    {
      id: 'games',
      nav: [
        { title: 'Games', icon: 'mdi-g', to: '/configure/games', order: 200, section: 'Games' },
      ],
      routes: [
        { path: '/configure/games', component: blank },
        { path: '/configure/games/:id', component: blank },
      ],
    },
    {
      id: 'dcs-setup',
      gamePages: [
        {
          title: 'DCS World',
          icon: 'mdi-airplane',
          to: '/configure/dcs',
          about: 'Screens, Export.lua and SimAppPro.',
          games: ['dcs'],
          order: 210,
        },
      ],
      routes: [
        {
          path: '/configure/dcs',
          component: blank,
          children: [
            { path: '', component: blank },
            { path: 'screens', component: blank },
          ],
        },
      ],
    },
    {
      id: 'racing',
      nav: [
        {
          title: 'Wheel',
          icon: 'mdi-w',
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
          about: 'Your wheel and the racing games.',
          games: ['iracing'],
          order: 220,
        },
      ],
      routes: [
        { path: '/configure/racing', component: blank },
        { path: '/configure/racing/lmu', component: blank },
        { path: '/configure/racing/wheel', component: blank },
      ],
    },
    {
      id: 'dcs-bindings',
      bindings: [{ game: 'dcs', name: 'DCS', to: '/configure/dcs-bindings', order: 10 }],
      routes: [{ path: '/configure/dcs-bindings/:tab?', component: blank }],
    },
    {
      id: 'iracing-bindings',
      bindings: [
        { game: 'iracing', name: 'iRacing', to: '/configure/iracing-bindings', order: 20 },
      ],
      routes: [{ path: '/configure/iracing-bindings', component: blank }],
    },
    MANIFESTS.find((m) => m.id === 'overlay')!,
    MANIFESTS.find((m) => m.id === 'devices')!,
  ];
  const pages = pageCommands(MENU);
  const page = (to: string) => pages.find((p) => p.to === to);

  it('lists Bindings, the shell’s entry, under its own name', () => {
    expect(page('/configure/bindings')).toMatchObject({
      title: 'Bindings',
      hint: 'Controls',
      feature: 'shell',
      group: GO_TO,
    });
  });

  it('keeps the names of the pages that left the menu, with the section they were in', () => {
    expect(page('/configure/dcs')).toMatchObject({
      title: 'DCS World',
      hint: 'Games',
      feature: 'dcs-setup',
    });
    expect(page('/configure/dcs/screens')).toMatchObject({
      title: 'DCS World: Screens',
      hint: 'DCS World',
    });
    expect(page('/configure/racing')).toMatchObject({ title: 'Racing', hint: 'Games' });
    expect(page('/configure/racing/lmu')).toMatchObject({ title: 'Racing: Lmu' });
    expect(page('/configure/dcs-bindings')).toMatchObject({
      title: 'DCS bindings',
      hint: 'Controls',
      feature: 'dcs-bindings',
    });
    expect(page('/configure/iracing-bindings')).toMatchObject({
      title: 'iRacing bindings',
      hint: 'Controls',
    });
    // Each once.
    expect(pages.filter((p) => p.to === '/configure/dcs')).toHaveLength(1);
    expect(pages.filter((p) => p.to === '/configure/dcs-bindings')).toHaveLength(1);
  });

  it('orders them where their entries stood: under Games after Games, under Bindings after Bindings', () => {
    expect(pages.map((p) => p.to)).toEqual([
      '/fly',
      '/fly/compact',
      '/configure/games',
      '/configure/dcs',
      '/configure/dcs/screens',
      '/configure/racing',
      '/configure/racing/lmu',
      '/configure/bindings',
      '/configure/dcs-bindings',
      '/configure/iracing-bindings',
      '/configure/overlay',
      '/configure/devices',
      '/configure/devices/test',
      '/configure/devices/usb',
      '/configure/racing/wheel',
    ]);
  });

  it('a feature whose page left the menu keeps its heading and its place among the headings', () => {
    const dcsSetup = MENU.find((m) => m.id === 'dcs-setup');
    const dcsBindings = MENU.find((m) => m.id === 'dcs-bindings');
    const devices = MENU.find((m) => m.id === 'devices');
    expect(areaOf(dcsSetup, 'dcs-setup')).toMatchObject({ title: 'DCS World' });
    expect(areaOf(dcsBindings, 'dcs-bindings')).toMatchObject({ title: 'DCS bindings' });
    expect(areaOf(dcsBindings, 'dcs-bindings').order).toBeLessThan(
      areaOf(devices, 'devices').order
    );
    // A page of the feature that already names its page gets no hint of the page's name.
    const tab = listed(
      { id: 'dcs-setup.screens', title: 'DCS World: Screens', to: '/configure/dcs/screens' },
      'dcs-setup',
      dcsSetup,
      0
    );
    expect(tab).toMatchObject({ group: GO_TO, kind: 'page' });
    expect(tab.hint).toBeUndefined();
  });

  it('a feature’s own name for its page becomes words it is found by; the page keeps its name', () => {
    const all = staticCommands(MENU, [
      {
        feature: 'iracing-bindings',
        commands: [
          {
            id: 'iracing-bindings.open',
            title: 'iRacing bindings',
            keywords: ['controls.cfg'],
            to: '/configure/iracing-bindings',
          },
        ],
      },
    ]);
    const found = all.filter((c) => c.to === '/configure/iracing-bindings');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: 'iRacing bindings', hint: 'Controls' });
    expect(found[0]!.keywords).toEqual(['iRacing bindings', 'controls.cfg']);
  });

  it('only Play comes first, with the Bindings entry and the places in', () => {
    const all = staticCommands(MENU, [
      {
        feature: 'dcs-bindings',
        commands: [{ id: 'dcs-bindings.clean', title: 'Clean up the defaults', run }],
      },
      { feature: 'about', commands: [{ id: 'about.copy', title: 'Copy the version', run }] },
      { feature: 'fly', commands: [{ id: 'fly.recheck', title: 'Re-check', run }] },
    ]);
    expect(all[0]).toMatchObject({ id: 'fly.recheck', group: 'Play' });
    expect([...new Set(all.map((c) => c.group))]).toEqual(['Play', 'DCS bindings', 'About', GO_TO]);
    const routes = all.filter((c) => c.group === GO_TO).map((c) => c.to);
    expect(routes.slice(0, 2)).toEqual(['/fly', '/fly/compact']);
  });
});
