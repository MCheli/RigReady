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
];

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

  it('orders them as the navigation does, each sub-page right after its page, Play first', () => {
    expect(pages.map((p) => p.to)).toEqual([
      '/fly',
      '/fly/compact',
      '/configure/profiles',
      '/configure/profiles/capture',
      '/configure/racing',
      '/configure/racing/assetto-corsa',
      '/configure/dcs-bindings',
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

  it('a feature without a navigation entry comes first, under its route’s title or its own name', () => {
    const about: FeatureManifest = {
      id: 'about',
      routes: [{ path: '/configure/about', component: blank, meta: { title: 'About this PC' } }],
    };
    expect(areaOf(about, 'about')).toMatchObject({ title: 'About this PC', order: -1 });
    expect(areaOf(undefined, 'checks-generic')).toMatchObject({
      title: 'Checks generic',
      order: -1,
    });
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
