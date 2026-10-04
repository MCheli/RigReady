/**
 * WOW-UI-001: the commands features contribute to the command palette, run against the real
 * main side (every feature wired onto the fake machine). Each command goes through its
 * feature's own IPC channel, input and output validated as in the app, and what it reports
 * is what the channel answered: asserted here both when it works and when it does not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err } from '../../src/core/result';
import { listDynamic, staticCommands } from '../../src/renderer/shell/registry';
import {
  collectCommands,
  type CommandOutcome,
  type CommandShell,
  type FeatureCommands,
  type PaletteCommand,
} from '../../src/shared/feature';
import { createClient, type Bridge } from '../../src/shared/ipc';
import type { InputState } from '../../src/shared/models';
import { mutate, repoRoot, wiredApp, type WiredApp } from '../helpers';
import { sabotage } from '../sabotage';

const discovered = import.meta.glob<{ default: FeatureCommands }>(
  '../../src/features/*/commands.ts',
  { eager: true }
);
const modules = collectCommands(discovered);
const moduleOf = (feature: string): FeatureCommands => modules.find((m) => m.feature === feature)!;

let app: WiredApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
  }
  app = undefined;
});

interface TestShell {
  shell: CommandShell;
  /** Routes the command opened. */
  went: string[];
  /** Lines it showed while running. */
  progress: string[];
  /** How often it told the screens to refresh. */
  refreshed: () => number;
}

/** The shell a command gets, with the wired main side behind the typed client. */
function shellFor(wired: WiredApp): TestShell {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  // Events reach the listeners as they are emitted, as they reach the window.
  const push = wired.events.push.bind(wired.events);
  wired.events.push = (...items) => {
    for (const { channel, payload } of items) {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
    }
    return push(...items);
  };
  const bridge: Bridge = {
    async invoke(channel, input) {
      const handler = wired.wiring.handlers.get(channel);
      if (!handler) return err('ipc.unknown', `Unknown channel ${channel}.`);
      return handler(input === undefined ? undefined : JSON.parse(JSON.stringify(input)));
    },
    on(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(listener);
      return () => set.delete(listener);
    },
  };
  const went: string[] = [];
  const progress: string[] = [];
  let refreshed = 0;
  return {
    went,
    progress,
    refreshed: () => refreshed,
    shell: {
      client: (contract) => createClient(contract, bridge),
      go: async (to) => {
        went.push(to);
      },
      route: () => '/fly',
      machineChanged: () => {
        refreshed++;
      },
      progress: (text) => {
        progress.push(text);
      },
    },
  };
}

/** `files`: which recorded game and tool files to copy (globs). Most commands need none. */
async function open(scenario: string, files: string[] = []): Promise<TestShell> {
  app = await wiredApp(scenario, { files });
  return shellFor(app);
}

/** A clock that moves a minute every time it is read, so "wait until it is running" loops end. */
function fastClock(wired: WiredApp): void {
  let tick = Date.parse('2026-10-03T12:00:00.000Z');
  wired.ports.clock.now = () => new Date((tick += 60_000));
}

/** Everything a feature offers on this machine right now. */
async function commandsOf(feature: string, shell: CommandShell): Promise<PaletteCommand[]> {
  const module = moduleOf(feature);
  return [...(module.commands ?? []), ...((await module.list?.(shell)) ?? [])];
}

async function find(feature: string, shell: CommandShell, title: string | RegExp) {
  const all = await commandsOf(feature, shell);
  const found = all.find((c) =>
    typeof title === 'string' ? c.title === title : title.test(c.title)
  );
  if (!found)
    throw new Error(`${feature} offers no "${title}": ${all.map((c) => c.title).join(', ')}`);
  return found;
}

async function run(command: PaletteCommand, shell: CommandShell): Promise<CommandOutcome> {
  const outcome = await command.run!(shell);
  if (!outcome) throw new Error(`${command.title} reported nothing`);
  return outcome;
}

describe('command discovery', () => {
  it('finds a commands.ts in every feature that has one, named after its folder, every command sound', () => {
    const folders = readdirSync(path.join(repoRoot, 'src', 'features')).filter((name) =>
      existsSync(path.join(repoRoot, 'src', 'features', name, 'commands.ts'))
    );
    expect(modules.map((m) => m.feature).sort()).toEqual(folders.sort());
    // What the palette was asked to offer, at least.
    for (const feature of [
      'fly',
      'displays',
      'backup',
      'devices',
      'dcs-bindings',
      'cheat-sheets',
      'diagnostics',
      'safety',
    ]) {
      expect(folders, feature).toContain(feature);
    }
    const ids = modules.flatMap((m) => (m.commands ?? []).map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(20);
  });

  it('every icon a command names exists in the icon font', () => {
    const css = readFileSync(
      path.join(repoRoot, 'node_modules', '@mdi', 'font', 'css', 'materialdesignicons.css'),
      'utf8'
    );
    const missing = modules
      .flatMap((m) => m.commands ?? [])
      .filter((c) => c.icon !== undefined && !css.includes(`.${c.icon}::before`))
      .map((c) => `${c.id}: ${c.icon}`);
    expect(missing).toEqual([]);
  });

  it('the pages features name are routes their manifests declare', () => {
    // The manifests import Vue components, so they are read as text here, as tests/e2e/a11y.ts does.
    const declared = new Set<string>();
    for (const feature of readdirSync(path.join(repoRoot, 'src', 'features'))) {
      const file = path.join(repoRoot, 'src', 'features', feature, 'index.ts');
      if (!existsSync(file)) continue;
      let parent = '';
      for (const match of readFileSync(file, 'utf8').matchAll(/\bpath:\s*'([^']*)'/g)) {
        const route = match[1]!;
        if (route.startsWith('/')) parent = route.replace(/\/:[^/]+\?/g, '');
        declared.add(route.startsWith('/') ? parent : route ? `${parent}/${route}` : parent);
      }
    }
    const strays = modules
      .flatMap((m) => m.commands ?? [])
      .filter((c) => c.to !== undefined)
      .map((c) => c.to!.split('?')[0]!)
      .filter((to) => !declared.has(to) && ![...declared].some((d) => to.startsWith(`${d}/`)));
    expect(strays).toEqual([]);
  });

  it('lists the features’ fixed commands without any manifest: under the feature’s name, or with the pages', () => {
    const all = staticCommands([], modules);
    expect(all.find((c) => c.id === 'backup.now')).toMatchObject({
      group: 'Backup',
      kind: 'action',
    });
    expect(all.find((c) => c.id === 'devices.tester')).toMatchObject({ kind: 'page' });
  });
});

/** Enough of the recorded files for the game modules to find the games: the programs, not their data. */
const INSTALLS = ['Program Files (x86)/**/*.exe', 'Program Files (x86)/Steam/steamapps/*'];

describe('Fly commands', () => {
  it('Re-check, Make ready, Launch and Stand down report what the Fly channels answered', async () => {
    const { shell, went, refreshed, progress } = await open('flying-trackir-not-running');
    const offered = (await commandsOf('fly', shell)).map((c) => c.title);
    expect(offered).toEqual(['Make ready', 'Launch', 'Stand down', 'Re-check']);

    const before = await run(await find('fly', shell, 'Re-check'), shell);
    expect(before).toMatchObject({
      tone: 'bad',
      text: 'DCS F/A-18C is not ready',
      action: { label: 'Open Fly', to: '/fly' },
    });
    expect(before.detail).toMatch(/^1 required item is not met: TrackIR/);

    const made = await run(await find('fly', shell, 'Make ready'), shell);
    expect(made).toMatchObject({ tone: 'ok', text: 'DCS F/A-18C is ready' });
    expect(made.detail).toBe('1 of 1 fix worked.');
    expect(made.action).toBeUndefined();
    // It really happened: the program is running on the fake machine.
    expect(app!.ports.state.processes.some((p) => /trackir5\.exe/i.test(p.name))).toBe(true);
    expect(progress).toContain('Making DCS F/A-18C ready…');

    const after = await run(await find('fly', shell, 'Re-check'), shell);
    expect(after).toMatchObject({ tone: 'ok', text: 'DCS F/A-18C is ready' });
    expect(after.detail).toMatch(/^\d+ items checked, all in place\.$/);

    const launched = await run(await find('fly', shell, 'Launch'), shell);
    expect(launched).toMatchObject({ tone: 'ok', text: 'Launched DCS.exe' });
    expect(app!.ports.state.processes.some((p) => /^dcs\.exe$/i.test(p.name))).toBe(true);

    const down = await run(await find('fly', shell, 'Stand down'), shell);
    expect(down.text).toMatch(/^Stood down: Closed \d+ apps?/);
    // The game runs: it is left open, and the outcome says so instead of calling it all done.
    expect(down).toMatchObject({ tone: 'warn', action: { to: '/fly' } });
    expect(down.detail).toMatch(/DCS\.exe is still running and was left open/);
    expect(app!.ports.state.processes.some((p) => /^dcs\.exe$/i.test(p.name))).toBe(true);

    // Every action tells the screens to look again; none of them opens a page by itself.
    expect(refreshed()).toBe(5);
    expect(went).toEqual([]);
  });

  it('Launch on a rig that is not ready launches, and says it was not ready', async () => {
    const { shell } = await open('flying-trackir-not-running');
    const launched = await run(await find('fly', shell, 'Launch'), shell);
    expect(launched).toMatchObject({
      tone: 'warn',
      text: 'Launched DCS.exe',
      action: { label: 'Open Fly', to: '/fly' },
    });
    expect(launched.detail).toMatch(/^It was not ready: 1 required item not met \(TrackIR/);
  });

  it('nothing is reported as done when the machine accepts a change and does not carry it out', async () => {
    const { shell } = await open('flying-trackir-not-running');
    fastClock(app!);
    const broken = sabotage(app!.ports);
    try {
      const made = await run(await find('fly', shell, 'Make ready'), shell);
      expect(made.tone).toBe('bad');
      expect(made.text).toBe('DCS F/A-18C is not ready');
      expect(made.detail).toMatch(/^0 of 1 fix worked\. Failed: TrackIR/);
      expect(broken.attempts.some((a) => /TrackIR5\.exe/i.test(a))).toBe(true);
    } finally {
      broken.restore();
    }
  });

  it('a switch to another setup makes it the one in use, opens Fly, and says how it stands', async () => {
    const { shell, went } = await open('fly-two-setups');
    const state = async () =>
      (await app!.invoke<{ activeProfileId: string; profiles: { id: string; name: string }[] }>(
        'fly:state'
      ))!;
    const first = await state();
    const other = first.profiles.find((p) => p.id !== first.activeProfileId)!;
    const switchTo = await find('fly', shell, `Switch to ${other.name}`);
    expect(switchTo.id).toBe(`fly.switch.${other.id}`);
    expect(switchTo.hint).toMatch(/·/);
    const outcome = await run(switchTo, shell);
    expect(outcome.text).toMatch(new RegExp(`^Now on the Fly screen: ${other.name} is `));
    expect((await state()).activeProfileId).toBe(other.id);
    expect(went).toEqual(['/fly']);
    // The setup that was in use is now the one that can be switched to.
    const titles = (await commandsOf('fly', shell)).map((c) => c.title);
    expect(titles).not.toContain(`Switch to ${other.name}`);
    expect(titles.some((t) => t.startsWith('Switch to '))).toBe(true);
  });

  it('with no setup yet there is one command: create the first', async () => {
    const { shell } = await open('flying-fresh');
    expect(await commandsOf('fly', shell)).toMatchObject([
      {
        id: 'fly.create',
        title: 'Create a setup from this rig',
        to: '/configure/profiles/capture',
      },
    ]);
  });

  it('knows the kind of game the setup in use is for', async () => {
    // What a game is comes from its module, which is asked about the games installed here.
    const flying = await open('flying-all-good', INSTALLS);
    expect(await moduleOf('fly').setupKind!(flying.shell)).toBe('flight');
    await app!.cleanup();
    const racing = await open('tour-racing', INSTALLS);
    expect(await moduleOf('fly').setupKind!(racing.shell)).toBe('racing');
    await app!.cleanup();
    const none = await open('flying-fresh');
    expect(await moduleOf('fly').setupKind!(none.shell)).toBeUndefined();
  });
});

describe('Monitors commands', () => {
  it('lists one command per saved layout, with how it differs from the monitors now', async () => {
    const { shell } = await open('displays-layouts');
    const layouts = (await commandsOf('displays', shell)).filter((c) =>
      c.id.startsWith('displays.apply.')
    );
    expect(layouts.map((c) => c.title).sort()).toEqual([
      'Apply layout: Desk',
      'Apply layout: Flying',
      'Apply layout: Racing',
    ]);
    const hint = (name: string): string => layouts.find((c) => c.title.endsWith(name))!.hint!;
    // The rig as recorded: the screens beside the stick are on and lying down, unlike any layout.
    expect(hint('Desk')).toMatch(/^\d+ differences$/);
    expect(hint('Flying')).toMatch(/^\d+ differences$/);
    expect(hint('Racing')).toMatch(/^Not connected: /);
  });

  it('applying a layout reports the answer to "Keep this layout?": kept, or gone back', async () => {
    const { shell, progress, refreshed } = await open('displays-layouts');
    const flying = await find('displays', shell, 'Apply layout: Flying');

    app!.layoutAnswer = 'revert';
    const back = await run(flying, shell);
    expect(back).toMatchObject({
      tone: 'warn',
      text: 'The Flying layout was not kept',
      detail: 'The monitors are back the way they were.',
      action: { label: 'Open Monitors', to: '/configure/displays' },
    });
    expect(progress).toContain('Applied "Flying". Keep it, or it goes back by itself…');

    app!.layoutAnswer = 'keep';
    const kept = await run(flying, shell);
    expect(kept).toEqual({ tone: 'ok', text: 'Applied "Flying", and kept' });
    expect(refreshed()).toBe(2);
    // The monitors really are arranged that way now.
    const again = await find('displays', shell, 'Apply layout: Flying');
    expect(again.hint).toBe('The monitors are arranged like this now');

    // Nothing to change: said as it is, not as "applied".
    const nothing = await run(again, shell);
    expect(nothing).toEqual({
      tone: 'info',
      text: 'The monitors already match "Flying". Nothing was changed.',
    });
  });

  it('a layout that needs a monitor that is not connected is refused, and nothing changes', async () => {
    const { shell } = await open('displays-layouts');
    const before = JSON.stringify(app!.ports.state.displays);
    const outcome = await run(await find('displays', shell, 'Apply layout: Racing'), shell);
    expect(outcome.tone).toBe('bad');
    expect(outcome.text).toMatch(/not connected\. Nothing was changed\.$/);
    expect(outcome.action).toEqual({ label: 'Open Monitors', to: '/configure/displays' });
    expect(JSON.stringify(app!.ports.state.displays)).toBe(before);
  });

  it('a layout the machine accepts and does not apply is not reported as applied', async () => {
    const { shell } = await open('displays-layouts');
    const flying = await find('displays', shell, 'Apply layout: Flying');
    const broken = sabotage(app!.ports);
    try {
      const outcome = await run(flying, shell);
      expect(outcome.tone).not.toBe('ok');
      expect(outcome.text).not.toMatch(/and kept/);
    } finally {
      broken.restore();
    }
  });

  it('Identify says how many monitors show their number and how many are off', async () => {
    const { shell } = await open('flying-all-good');
    const outcome = await run(await find('displays', shell, 'Identify monitors'), shell);
    expect(outcome).toEqual({
      tone: 'ok',
      text: 'Each monitor that is on shows its number (4)',
      detail: '1 monitor is off and shows nothing.',
    });
    expect(app!.ports.overlays.shown).toHaveLength(1);
  });

  it('when the monitors cannot be read, the layouts are not listed and the reason is kept', async () => {
    const { shell } = await open('displays-layouts');
    await mutate(app!, [
      { op: 'failProvider', port: 'displays', message: 'The display driver did not answer.' },
    ]);
    const listing = await listDynamic(moduleOf('displays'), undefined, shell);
    expect(listing.commands).toEqual([]);
    expect(listing.problem).toMatch(/display/i);
    const identify = moduleOf('displays').commands!.find((c) => c.id === 'displays.identify')!;
    const outcome = await run(identify, shell);
    expect(outcome.tone).toBe('bad');
    expect(outcome.text).toMatch(/display/i);
  });
});

describe('Backups command', () => {
  it('"Back up now" writes a full backup and reports the one that was written', async () => {
    const { shell, progress } = await open('flying-all-good', ['Saved Games/DCS/Config/**']);
    const outcome = await run(await find('backup', shell, 'Back up now'), shell);
    expect(outcome.tone).toBe('ok');
    expect(outcome.text).toMatch(/^Backed up \d+ files? \([\d.]+ (bytes|KB|MB)\) as ".+"$/);
    expect(outcome.action).toEqual({ label: 'Open Backups', to: '/configure/backups' });
    expect(progress[0]).toBe('Backing up…');
    // The file is there, and the number in the toast is the number in the list.
    const overview = await app!.invoke<{ backups: { name: string; fileCount: number }[] }>(
      'backup:overview'
    );
    expect(overview.backups).toHaveLength(1);
    expect(outcome.text).toContain(`"${overview.backups[0]!.name}"`);
    expect(outcome.text).toContain(`Backed up ${overview.backups[0]!.fileCount} file`);
    const folder = path.join(app!.ports.folders.dataRoot(), 'backups');
    expect(readdirSync(folder).some((f) => f.endsWith('.zip'))).toBe(true);
  });
});

describe('Devices commands', () => {
  const rest = (index: number, name: string): InputState => ({
    index,
    name,
    axes: [0, 0],
    buttons: [false, false, false, false, false, false],
    hats: [],
    timestamp: 1,
  });

  it('"Find a device" names the device whose button was pressed and opens it on the Devices page', async () => {
    const { shell, went, progress } = await open('flying-all-good');
    const controllers =
      await app!.invoke<{ index: number; name: string }[]>('devices:inputDevices');
    const target = controllers[2]!;
    const overview = await app!.invoke<{
      devices: { key: string; name: string; controllers: { index: number }[] }[];
    }>('devices:overview');
    const device = overview.devices.find((d) =>
      d.controllers.some((c) => c.index === target.index)
    )!;

    const finding = run(await find('devices', shell, 'Find a device'), shell);
    await vi.waitFor(() =>
      expect(progress).toContain('Press a button on the device you are looking for…')
    );
    // Where it rests first, then button 5 goes down.
    app!.ports.input.emit([rest(target.index, target.name)]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const pressed = rest(target.index, target.name);
    pressed.buttons[4] = true;
    pressed.timestamp = 2;
    app!.ports.input.emit([pressed]);

    const outcome = await finding;
    expect(outcome).toEqual({
      tone: 'ok',
      text: `That is ${device.name}`,
      detail: 'Button 5 was pressed. It is open on the Devices page.',
    });
    expect(went).toEqual([`/configure/devices?select=${encodeURIComponent(device.key)}`]);
  });

  it('"Find a device" stops listening after a while and says that nothing was pressed', async () => {
    const { shell, went, progress } = await open('flying-all-good');
    const command = await find('devices', shell, 'Find a device');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const finding = run(command, shell);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(50);
      expect(progress).toContain('Press a button on the device you are looking for…');
    });
    await vi.advanceTimersByTimeAsync(21_000);
    const outcome = await finding;
    expect(outcome).toMatchObject({ tone: 'info', text: 'Nothing was pressed' });
    expect(outcome.detail).toMatch(/listened for 20 seconds/);
    expect(went).toEqual([]);
  });

  it('"Find a device" on a PC without a game controller says so instead of listening', async () => {
    const { shell, progress } = await open('generic-fresh');
    await mutate(app!, [{ op: 'unplugDevice', match: { vendorId: '046D', productId: 'C215' } }]);
    const outcome = await run(await find('devices', shell, 'Find a device'), shell);
    expect(outcome).toMatchObject({ tone: 'warn', text: 'No game controller is connected' });
    expect(progress).toEqual([]);
  });

  it('offers the device tools as pages under their own names', async () => {
    const pages = (moduleOf('devices').commands ?? []).filter((c) => c.to !== undefined);
    expect(pages.map((c) => [c.title, c.to])).toEqual([
      ['Input tester', '/configure/devices/test'],
      ['Health check', '/configure/devices/health'],
      ['USB map', '/configure/devices/usb'],
      ['Controllers and hardware', '/configure/devices'],
    ]);
  });
});

describe('DCS bindings and cheat sheet commands', () => {
  it('open the bindings page on an aircraft: the ones with bindings of your own first', async () => {
    const { shell } = await open('flying-all-good', [
      'Saved Games/DCS/**',
      'Program Files (x86)/Steam/**',
    ]);
    const aircraft = (await commandsOf('dcs-bindings', shell)).filter((c) =>
      c.id.startsWith('dcs-bindings.aircraft.')
    );
    expect(aircraft.length).toBeGreaterThan(0);
    expect(aircraft[0]).toMatchObject({
      id: 'dcs-bindings.aircraft.FA-18C_hornet',
      group: 'DCS bindings',
      to: '/configure/dcs-bindings?aircraft=FA-18C_hornet',
    });
    expect(aircraft[0]!.title).toMatch(/^Bindings: F\/A-18C/);
    expect(aircraft[0]!.hint).toMatch(/^\d+ binding files$/);
  });

  it('open the cheat sheet of an aircraft', async () => {
    const { shell } = await open('flying-all-good', [
      'Saved Games/DCS/**',
      'Program Files (x86)/Steam/**',
    ]);
    const sheets = (await commandsOf('cheat-sheets', shell)).filter((c) =>
      c.id.startsWith('cheat-sheets.sheet.')
    );
    expect(sheets[0]).toMatchObject({
      id: 'cheat-sheets.sheet.dcs.FA-18C_hornet',
      group: 'Cheat sheets',
      hint: 'Your bindings',
      to: '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet',
    });
    expect(sheets[0]!.title).toMatch(/^Cheat sheet: F\/A-18C/);
    const quick = await find('cheat-sheets', shell, 'Quick look');
    expect(quick.to).toBe('/configure/cheat-sheets/quick');
  });

  it('on a PC without DCS there is no aircraft to open, and nothing fails', async () => {
    const { shell } = await open('generic-fresh');
    for (const feature of ['dcs-bindings', 'cheat-sheets']) {
      const listing = await listDynamic(moduleOf(feature), undefined, shell);
      expect(listing.problem, feature).toBeUndefined();
      expect(listing.commands, feature).toEqual([]);
    }
  });
});

describe('Diagnostics and Safety commands', () => {
  it('"Copy the diagnostics report" puts the report on the clipboard and says how much it was', async () => {
    const { shell } = await open('flying-all-good');
    const outcome = await run(
      await find('diagnostics', shell, 'Copy the diagnostics report'),
      shell
    );
    expect(outcome.tone).toBe('ok');
    expect(outcome.text).toBe('The diagnostics report is on the clipboard');
    const copied = app!.ports.clipboard.copied;
    expect(copied).toHaveLength(1);
    expect(copied[0]!.length).toBeGreaterThan(200);
    expect(outcome.detail).toContain(`${copied[0]!.length.toLocaleString('en-US')} characters`);
  });

  it('Safety is found by the words people look for it by', () => {
    const safety = moduleOf('safety').commands!;
    expect(safety).toHaveLength(1);
    expect(safety[0]).toMatchObject({ to: '/configure/safety' });
    expect(safety[0]!.keywords).toEqual(expect.arrayContaining(['undo', 'changes']));
  });
});
