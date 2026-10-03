/**
 * The main side as the renderer sees it: every discovered feature wired onto fake
 * ports, called through the same validated IPC handlers the app registers.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import type { Profile } from '../../src/core/profile/schema';
import { discoverFeatures, wireFeatures } from '../../src/main/bootstrap';
import { nullLogger } from '../../src/core/logger';
import { ok } from '../../src/core/result';
import type { GameSummary } from '../../src/features/games/contract';
import dcs from '../../src/features/games/dcs/module';
import { summarizeGames } from '../../src/features/games/core/summary';
import { GameRegistry } from '../../src/core/games';
import { wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(() => app?.cleanup());

const P = { profileId: 'dcs-f-a-18c' };
const statusOf = (report: ChecklistReport, title: string) =>
  report.results.find((r) => r.title === title)?.status;

describe('feature discovery', () => {
  it('finds every feature folder and registers its checks, fixes and channels', async () => {
    app = await wiredApp('flying-all-good');
    expect(app.wiring.features.map((f) => f.id)).toEqual([
      'audio',
      'devices',
      'displays',
      'fly',
      'games',
      'processes',
      'profiles',
      'racing',
      'safety',
      'settings',
      'stream-deck',
      'trackir',
    ]);
    expect(app.wiring.context.checks.checkTypes()).toEqual([
      'audio.defaultDevice',
      'device.connected',
      'display.layout',
      'process.running',
      'racing.iracingDevices',
      'racing.iracingService',
      'racing.wheelBase',
      'racing.wheelSettings',
      'stream-deck.connected',
      'stream-deck.running',
      'trackir.connected',
      'trackir.running',
    ]);
    expect(app.wiring.context.checks.remediationTypes()).toEqual([
      'audio.setDefault',
      'display.applyLayout',
      'process.launch',
      'stream-deck.start',
      'trackir.start',
    ]);
    expect([...app.wiring.handlers.keys()]).toContain('fly:makeReady');
    expect(app.wiring.context.games.get('dcs')?.name).toBe('DCS World');
  });

  it('refuses duplicate feature ids and duplicate channels', async () => {
    app = await wiredApp('flying-all-good');
    const features = discoverFeatures();
    const base = { ports: app.ports, log: nullLogger, send: () => {} };
    expect(() => wireFeatures({ ...base, features: [features[0]!, features[0]!] })).toThrow(
      /twice/
    );
  });
});

describe('Fly, end to end on scenarios', () => {
  it('all good: opens on the seeded setup, every check passes, Ready', async () => {
    app = await wiredApp('flying-all-good');
    const state = await app.invoke<{
      profiles: { id: string; name: string; canLaunch: boolean }[];
      activeProfileId?: string;
    }>('fly:state');
    expect(state).toEqual({
      profiles: [{ id: 'dcs-f-a-18c', name: 'DCS F/A-18C', canLaunch: true }],
      activeProfileId: 'dcs-f-a-18c',
    });
    const report = await app.invoke<ChecklistReport>('fly:check', P);
    expect(report).toMatchObject({ ready: true, failed: 0, warnings: 0, fixable: 0 });
    expect(report.results).toHaveLength(16);
    expect(new Set(report.results.map((r) => r.group))).toEqual(
      new Set(['devices', 'apps', 'displays'])
    );
    expect(await app.wiring.context.profiles.lastProfileId()).toBe('dcs-f-a-18c');
  });

  it('pedals unplugged: one required device fails, nothing can fix it, Not ready', async () => {
    app = await wiredApp('flying-pedals-unplugged');
    const report = await app.invoke<ChecklistReport>('fly:check', P);
    expect(report).toMatchObject({ ready: false, failed: 1, warnings: 0, fixable: 0 });
    expect(statusOf(report, 'T-Pendular-Rudder')).toBe('fail');
    const made = await app.invoke<ActionReport>('fly:makeReady', P);
    expect(made.steps).toEqual([]);
    expect(made.report.ready).toBe(false);
  });

  it('optional device missing: yellow, never red, and still Ready', async () => {
    app = await wiredApp('flying-optional-missing');
    const report = await app.invoke<ChecklistReport>('fly:check', P);
    expect(statusOf(report, 'Stream Deck XL')).toBe('warn');
    expect(report).toMatchObject({ ready: true, failed: 0, warnings: 1 });
  });

  it('TrackIR not running: Make ready starts it and the setup becomes Ready', async () => {
    app = await wiredApp('flying-trackir-not-running');
    const before = await app.invoke<ChecklistReport>('fly:check', P);
    expect(before).toMatchObject({ ready: false, failed: 1, fixable: 1 });
    expect(before.results.find((r) => r.title === 'TrackIR5')).toMatchObject({
      status: 'fail',
      summary: 'Not running',
      fix: 'Start TrackIR5.exe',
    });
    const made = await app.invoke<ActionReport>('fly:makeReady', P);
    expect(made.steps).toEqual([
      { itemId: 'c13', title: 'TrackIR5', ok: true, message: 'Started TrackIR5.exe' },
    ]);
    expect(made.report.ready).toBe(true);
    expect(app.ports.processes.started.map((s) => s.exe)).toEqual([
      'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
    ]);
  });

  it('MFD rotated: Make ready applies the layout, announces the timed revert, Keep settles it', async () => {
    app = await wiredApp('flying-mfd-rotated');
    const before = await app.invoke<ChecklistReport>('fly:check', P);
    expect(before.results.find((r) => r.title === 'Monitor layout')).toMatchObject({
      status: 'fail',
      details: [
        'USB_Monitor (2 of 3) is rotated 0°, expected 90°',
        'USB_Monitor (2 of 3) is 1024x768, expected 768x1024',
      ],
      fix: 'Apply the monitor layout',
    });
    const made = await app.invoke<ActionReport>('fly:makeReady', P);
    expect(made.steps).toEqual([
      {
        itemId: 'c16',
        title: 'Monitor layout',
        ok: true,
        message: 'Applied the layout to 4 monitors',
      },
    ]);
    expect(made.report.ready).toBe(true);
    expect(app.events).toEqual([{ channel: 'displays:event:applied', payload: { seconds: 15 } }]);
    expect(await app.invoke('displays:pending')).toEqual({ pending: true, seconds: 15 });
    expect(await app.invoke('displays:keep')).toEqual({ kept: true });
    expect(app.events[1]).toEqual({
      channel: 'displays:event:settled',
      payload: { outcome: 'kept' },
    });
    expect(await app.invoke('displays:keep')).toEqual({ kept: false });
    expect((await app.invoke<ChecklistReport>('fly:check', P)).ready).toBe(true);
  });

  it('desk state: Make ready fixes the layout; Go back restores the desk; Stand down does too and closes TrackIR', async () => {
    app = await wiredApp('desk-mfds-wrong');
    const desk = await app.invoke('displays:read');
    const made = await app.invoke<ActionReport>('fly:makeReady', P);
    expect(made.report.ready).toBe(true);
    const flying = await app.invoke<{
      displays: { name: string; enabled: boolean; primary: boolean }[];
    }>('displays:read');
    expect(flying.displays.find((d) => d.name === 'DELL G3223D')!.enabled).toBe(false);
    expect(flying.displays.find((d) => d.name === 'LC49G95T')!.primary).toBe(true);

    expect(await app.invoke('displays:revert')).toEqual(desk);
    expect((await app.invoke<ChecklistReport>('fly:check', P)).ready).toBe(false);

    await app.invoke<ActionReport>('fly:makeReady', P);
    await app.invoke('displays:keep');
    const down = await app.invoke<ActionReport>('fly:standDown', P);
    expect(down.steps.map((s) => s.message)).toEqual([
      'Closed TrackIR5.exe',
      'Restored the earlier monitor layout',
    ]);
    expect(await app.invoke('displays:read')).toEqual(desk);
    expect(statusOf(down.report, 'TrackIR5')).toBe('fail');
    // Nothing left to stand down.
    expect((await app.invoke<ActionReport>('fly:standDown', P)).steps).toEqual([]);
  });

  it('Launch starts the game whether or not the setup is ready', async () => {
    app = await wiredApp('flying-pedals-unplugged');
    expect((await app.invoke<ChecklistReport>('fly:check', P)).ready).toBe(false);
    expect(await app.invoke('fly:launch', P)).toEqual({ message: 'Started DCS.exe' });
    expect(app.ports.processes.started).toEqual([
      {
        exe: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe',
        args: [],
      },
    ]);
  });

  it('reports unknown profiles and setups without a launch program as errors', async () => {
    app = await wiredApp('flying-all-good');
    for (const channel of ['fly:check', 'fly:makeReady', 'fly:standDown', 'fly:launch']) {
      await expect(app.invoke(channel, { profileId: 'nope' })).rejects.toThrow(/profile.missing/);
    }
    await expect(app.invoke('fly:check', {})).rejects.toThrow(/ipc.input/);
    const profile = await app.invoke<Profile>('profiles:get', { id: 'dcs-f-a-18c' });
    const { launch: _launch, ...withoutLaunch } = profile;
    await app.invoke('profiles:save', withoutLaunch);
    await expect(app.invoke('fly:launch', P)).rejects.toThrow(/fly.noLaunch/);
  });
});

describe('Profiles: create by capturing the current state', () => {
  it('captures devices, apps and monitors; the created setup is Ready; breaking the rig is detected', async () => {
    app = await wiredApp('flying-fresh');
    expect(await app.invoke('fly:state')).toEqual({ profiles: [] });
    const capture = await app.invoke<{
      candidates: {
        key: string;
        group: string;
        title: string;
        selectedByDefault: boolean;
        check: Profile['checks'][number];
      }[];
      problems: string[];
    }>('profiles:capture');
    expect(capture.problems).toEqual([]);
    expect(new Set(capture.candidates.map((c) => c.group))).toEqual(
      new Set(['devices', 'apps', 'displays', 'audio'])
    );

    // What the capture screen does: keep the defaults plus the apps the user ticks.
    const chosen = capture.candidates.filter(
      (c) => c.selectedByDefault || ['TrackIR5', 'SimAppPro', 'Stream Deck XL'].includes(c.title)
    );
    const created = await app.invoke<Profile>('profiles:create', {
      name: 'DCS F/A-18C',
      launch: { exe: 'C:\\DCS\\bin\\DCS.exe', args: ['--force_enable_VR'] },
      checks: chosen.map((c) =>
        c.title === 'Stream Deck XL' ? { ...c.check, required: false } : c.check
      ),
    });
    expect(created.id).toBe('dcs-f-a-18c');
    expect(created.checks.map((c) => c.id)).toEqual(chosen.map((_, i) => `c${i + 1}`));
    const onDisk = await fs.readFile(
      path.join(app.ports.folders.dataRoot(), 'profiles', 'dcs-f-a-18c.yaml'),
      'utf8'
    );
    expect(onDisk).toContain('type: display.layout');

    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: created.id });
    expect(report).toMatchObject({ ready: true, failed: 0, warnings: 0 });

    // Now the rig changes underneath it.
    app.ports.state.devices = app.ports.state.devices.filter(
      (d) => d.productId !== 'B68F' && d.productId !== '008F'
    );
    app.ports.state.processes = app.ports.state.processes.filter((p) => p.name !== 'TrackIR5.exe');
    const broken = await app.invoke<ChecklistReport>('fly:check', { profileId: created.id });
    expect(broken).toMatchObject({ ready: false, failed: 2, warnings: 1, fixable: 1 });

    // A second setup with the same name gets its own id.
    const second = await app.invoke<Profile>('profiles:create', {
      name: 'DCS F/A-18C',
      checks: [],
    });
    expect(second.id).toBe('dcs-f-a-18c-2');
    expect((await app.invoke<Profile[]>('profiles:list')).map((p) => p.id)).toEqual([
      'dcs-f-a-18c',
      'dcs-f-a-18c-2',
    ]);
  });

  it('edits and deletes', async () => {
    app = await wiredApp('flying-all-good');
    const profile = await app.invoke<Profile>('profiles:get', { id: 'dcs-f-a-18c' });
    app.clock.advance(60_000);
    const saved = await app.invoke<Profile>('profiles:save', {
      ...profile,
      name: 'Hornet',
      createdAt: 'tampered',
      checks: profile.checks.filter((c) => c.type !== 'device.connected'),
    });
    expect(saved).toMatchObject({
      name: 'Hornet',
      createdAt: profile.createdAt,
      updatedAt: '2026-10-03T12:01:00.000Z',
    });
    expect(saved.checks).toHaveLength(4);
    await expect(
      app.invoke('profiles:save', { ...profile, checks: [profile.checks[0], profile.checks[0]] })
    ).rejects.toThrow(/same id/);
    await expect(app.invoke('profiles:save', { ...profile, id: 'unknown' })).rejects.toThrow(
      /profile.missing/
    );
    await expect(app.invoke('profiles:create', { name: '   ', checks: [] })).rejects.toThrow(
      /ipc.input/
    );
    expect(await app.invoke('profiles:remove', { id: 'dcs-f-a-18c' })).toEqual({ removed: true });
    expect(await app.invoke('profiles:list')).toEqual([]);
  });
});

describe('Devices and games', () => {
  it('lists devices through IPC', async () => {
    app = await wiredApp('racing-fresh');
    const devices = await app.invoke<{ name: string; vendorId: string }[]>('devices:list');
    expect(devices.some((d) => d.name === 'FANATEC Podium Wheel Base DD2')).toBe(true);
    expect(devices.some((d) => d.vendorId === '4098')).toBe(false);
  });

  it('DCS module finds Steam installs in every library and the Saved Games folder', async () => {
    app = await wiredApp('flying-all-good');
    // The scenario mirrors the rig's recorded files into the fake home: the Saved Games
    // folder, and the Steam library (found through the recorded registry) with DCS in it.
    const savedGames = path.join(app.ports.folders.savedGames(), 'DCS');
    const recorded = path.join(app.home, 'Program Files (x86)', 'Steam', 'steamapps', 'common');
    const listed = await app.invoke<GameSummary[]>('games:list');
    expect(listed.filter((g) => g.id === 'dcs')).toMatchObject([
      {
        id: 'dcs',
        name: 'DCS World',
        installs: [
          {
            source: 'steam',
            installDir: path.join(recorded, 'DCSWorld'),
            launch: {
              exe: path.join(recorded, 'DCSWorld', 'bin', 'DCS.exe'),
              args: [],
              cwd: path.join(recorded, 'DCSWorld', 'bin'),
            },
          },
        ],
        configLocations: [{ id: 'dcs', label: 'Saved Games\\DCS', path: savedGames }],
        problems: [],
      },
    ]);
    const joystick = path.join(savedGames, 'Config', 'Input', 'FA-18C_hornet', 'joystick');
    expect((await fs.readdir(joystick)).some((f) => f.startsWith('WINWING MFD1-L {'))).toBe(true);

    const library = path.join(app.home, 'SteamLibrary');
    const installDir = path.join(library, 'steamapps', 'common', 'DCSWorld');
    await fs.mkdir(path.join(installDir, 'bin'), { recursive: true });
    await fs.writeFile(path.join(installDir, 'bin', 'DCS.exe'), '');
    app.ports.folders.steamLibraries = async () =>
      ok([path.join(app.home, 'EmptyLibrary'), library]);
    const summary = (await app.invoke<GameSummary[]>('games:list')).find((g) => g.id === 'dcs');
    expect(summary!.installs).toEqual([
      {
        source: 'steam',
        installDir,
        launch: {
          exe: path.join(installDir, 'bin', 'DCS.exe'),
          args: [],
          cwd: path.join(installDir, 'bin'),
        },
      },
    ]);
    expect(summary!.configLocations).toEqual([
      {
        id: 'dcs',
        label: 'Saved Games\\DCS',
        path: path.join(app.ports.folders.savedGames(), 'DCS'),
      },
    ]);
  });

  it('a game module that fails is reported, not fatal', async () => {
    app = await wiredApp('flying-all-good');
    const games = new GameRegistry();
    games.register(dcs);
    games.register({
      id: 'x',
      name: 'Broken',
      detect: async () => ({ ok: false, error: { code: 'x', message: 'no registry' } }),
      configLocations: async () => ({ ok: false, error: { code: 'x', message: 'no folder' } }),
    });
    games.register({
      id: 'y',
      name: 'Crashes',
      detect: async () => {
        throw new Error('boom');
      },
      configLocations: async () => ok([]),
    });
    app.ports.folders.steamLibraries = async () => ({
      ok: false,
      error: { code: 's', message: 'Steam unreadable' },
    });
    const summaries = await summarizeGames(games, app.ctx);
    expect(summaries.map((s) => [s.id, s.problems])).toEqual([
      ['x', ['no registry', 'no folder']],
      ['y', ['boom']],
      ['dcs', ['Steam unreadable']],
    ]);
  });
});
