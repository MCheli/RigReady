/**
 * Behaviour that crosses feature boundaries: the Shell port's environment and hidden
 * options, what scripts are told about the setup, the scenario mutations that plug a
 * device in, hang a provider or make a program fail to start, and launching through Steam.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dedupeCandidates, fixItem, runChecks } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import { NameRegistry } from '../../src/core/names';
import type { CheckItem, Profile } from '../../src/core/profile/schema';
import { Fly } from '../../src/features/fly/core/fly';
import { applyMutations } from '../../src/platform/fake/scenario';
import { launchSpawnOptions, runSpawnOptions } from '../../src/platform/node';
import { markFull, mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(async () => {
  vi.useRealTimers();
  await app?.cleanup();
});

const profileOf = (checks: CheckItem[], extra: Partial<Profile> = {}): Profile => ({
  schemaVersion: 1,
  id: 'p',
  name: 'DCS F/A-18C',
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  checks,
  extensions: {},
  ...extra,
});

async function saveProfile(profile: Profile): Promise<void> {
  const saved = await app.wiring.context.profiles.save(profile);
  if (!saved.ok) throw new Error(saved.error.message);
}

function fly(): Fly {
  return new Fly(
    app.wiring.context,
    { result: () => {}, progress: () => {}, launchProgress: () => {} },
    { sleep: async (ms) => app.clock.advance(ms), timer: () => new Promise(() => {}) }
  );
}

const PEDALS: CheckItem = {
  id: 'pedals',
  type: 'device.connected',
  title: 'T-Pendular-Rudder',
  required: true,
  params: { vendorId: '044F', productId: 'B68F' },
};

describe('Shell: environment and hidden windows', () => {
  it('run() never uses a shell, hides the console window by default and adds the given variables', () => {
    expect(runSpawnOptions({}, { PATH: 'x' })).toEqual({
      cwd: undefined,
      shell: false,
      windowsHide: true,
      timeout: 30_000,
    });
    expect(
      runSpawnOptions(
        { hidden: true, env: { RIGREADY_PROFILE_NAME: 'A & B' }, timeoutMs: 5000, cwd: 'C:\\x' },
        { PATH: 'x' }
      )
    ).toEqual({
      cwd: 'C:\\x',
      shell: false,
      windowsHide: true,
      timeout: 5000,
      env: { PATH: 'x', RIGREADY_PROFILE_NAME: 'A & B' },
    });
    expect(runSpawnOptions({ hidden: false }).windowsHide).toBe(false);
  });

  it('launch() shows the program unless hidden is asked for, and stays detached', () => {
    expect(launchSpawnOptions('C:\\Tools\\a.exe')).toEqual({
      cwd: 'C:\\Tools',
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    expect(
      launchSpawnOptions('C:\\Tools\\a.exe', { hidden: true, env: { A: '1' } }, { B: '2' })
    ).toMatchObject({ windowsHide: true, env: { A: '1', B: '2' } });
  });
});

describe('what a script is told about the setup', () => {
  it('passes the setup, the game and its folders as environment variables, and arguments as literal elements', async () => {
    app = await wiredApp('flying-all-good');
    const script = path.join(app.home, 'Scripts', 'prepare.cmd');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '@echo off');
    const item: CheckItem = {
      id: 's',
      type: 'script.check',
      title: 'Prepare',
      required: true,
      params: { exe: '{USER}/Scripts/prepare.cmd', args: ['--name', 'x && del *'] },
      remediation: {
        type: 'script.run',
        params: { exe: '{USER}/Scripts/prepare.cmd', args: ['%RIGREADY_PROFILE_NAME%'] },
      },
    };
    const profile = profileOf([item], { name: 'DCS "F/A-18C" & friends', game: 'dcs' });
    const { checks } = app.wiring.context;
    await runChecks(profile, checks, app.ctx);
    const steamapps = path.join(app.ports.folders.programFilesX86(), 'Steam', 'steamapps');
    const env = {
      RIGREADY_PROFILE_NAME: 'DCS "F/A-18C" & friends',
      RIGREADY_PROFILE_ID: 'p',
      RIGREADY_GAME: 'dcs',
      RIGREADY_GAME_PATH: path.join(steamapps, 'common', 'DCSWorld'),
      RIGREADY_USER_DATA: path.join(app.ports.folders.savedGames(), 'DCS'),
      RIGREADY_HOME: app.ports.folders.dataRoot(),
    };
    expect(app.ports.shell.calls.at(-1)).toEqual({
      exe: script,
      // One element each: nothing from the setup is ever joined into a command line.
      args: ['--name', 'x && del *'],
      options: { timeoutMs: 10_000, env, hidden: true },
    });

    await fixItem(profile, 's', checks, app.ctx, { confirm: async () => true });
    const ran = app.ports.shell.calls.find((c) => c.args[0] === '%RIGREADY_PROFILE_NAME%');
    expect(ran?.options).toEqual({ timeoutMs: 30_000, env, hidden: true });

    // A setup without a known game: the game variables are there and empty.
    await runChecks(profileOf([item], { name: 'Plain' }), checks, app.ctx);
    expect(app.ports.shell.calls.at(-1)!.options!.env).toEqual({
      RIGREADY_PROFILE_NAME: 'Plain',
      RIGREADY_PROFILE_ID: 'p',
      RIGREADY_GAME: '',
      RIGREADY_GAME_PATH: '',
      RIGREADY_USER_DATA: '',
      RIGREADY_HOME: app.ports.folders.dataRoot(),
    });
  });
});

describe('scenario mutations for plugging in, hanging and failing', () => {
  it('plugDevice brings back what was unplugged, controller included, and adds new devices', async () => {
    const base = await markFull();
    const pedals = { vendorId: '044F', productId: 'B68F' };
    const unplugged = applyMutations(base, [{ op: 'unplugDevice', match: pedals }]);
    expect(unplugged.devices.some((d) => d.productId === 'B68F')).toBe(false);
    expect(unplugged.input.some((d) => d.productId === 'B68F')).toBe(false);
    const back = applyMutations(unplugged, [{ op: 'plugDevice', match: pedals }]);
    expect(back.devices.filter((d) => d.productId === 'B68F')).toEqual(
      base.devices.filter((d) => d.productId === 'B68F')
    );
    expect(back.input.find((d) => d.productId === 'B68F')?.guid).toBe(
      base.input.find((d) => d.productId === 'B68F')?.guid
    );
    expect(back.input.map((d) => d.index)).toEqual(back.input.map((_, i) => i));
    expect(() => applyMutations(back, [{ op: 'plugDevice', match: pedals }])).toThrow(
      /matched no unplugged device/
    );

    const added = applyMutations(base, [
      {
        op: 'plugDevice',
        device: {
          instanceId: 'USB\\VID_0EB7&PID_0006\\7&1',
          vendorId: '0EB7',
          productId: '0006',
          name: 'FANATEC Podium Wheel Base DD2 (compatibility mode)',
          isHid: true,
          isGameController: true,
          isHub: false,
          hubChain: [],
        },
        controller: {
          name: 'FANATEC Podium Wheel Base DD2',
          guid: 'AAAAAAAA-0000-0000-0000-444553540000',
          productGuid: '',
          vendorId: '0EB7',
          productId: '0006',
          axisNames: [],
        },
      },
    ]);
    expect(added.devices.at(-1)).toMatchObject({ vendorId: '0EB7', productId: '0006' });
    expect(added.input.at(-1)).toMatchObject({
      index: base.input.length,
      numButtons: 32,
      guid: 'AAAAAAAA-0000-0000-0000-444553540000',
    });
    expect(() =>
      applyMutations(added, [
        {
          op: 'plugDevice',
          device: { ...added.devices.at(-1)!, instanceId: 'usb\\vid_0eb7&pid_0006\\7&1' },
        },
      ])
    ).toThrow(/already connected/);
  });

  it('setController gives a controller a new instance GUID or name, one of several identical ones too', async () => {
    const base = await markFull();
    const first = base.input[0]!;
    const next = applyMutations(base, [
      {
        op: 'setController',
        match: { guid: first.guid.toLowerCase() },
        set: { guid: 'bbbbbbbb-1111-2222-3333-444553540000' },
      },
      { op: 'setController', match: { name: 'pendular', nth: 0 }, set: { name: 'Renamed' } },
    ]);
    expect(next.input[0]!.guid).toBe('BBBBBBBB-1111-2222-3333-444553540000');
    expect(next.input.some((d) => d.name === 'Renamed')).toBe(true);
    expect(() =>
      applyMutations(base, [{ op: 'setController', match: { name: 'nope' }, set: { name: 'x' } }])
    ).toThrow(/matched no controller/);
    expect(() =>
      applyMutations(base, [
        { op: 'setController', match: { vendorId: '4098', nth: 99 }, set: { name: 'x' } },
      ])
    ).toThrow(/matched no controller/);
  });

  it('a device that is unplugged and plugged back turns its check red and green again', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { checks } = app.wiring.context;
    const profile = profileOf([PEDALS]);
    let notified = 0;
    app.ports.devices.subscribe(() => notified++);
    await mutate(app, [{ op: 'unplugDevice', match: { productId: 'B68F' } }]);
    expect((await runChecks(profile, checks, app.ctx)).results[0]).toMatchObject({
      status: 'fail',
    });
    await mutate(app, [{ op: 'plugDevice', match: { productId: 'B68F' } }]);
    expect((await runChecks(profile, checks, app.ctx)).ready).toBe(true);
    // Each change tells subscribers, which is what refreshes the Fly screen.
    expect(notified).toBe(2);
  });

  it('a provider that never answers times out its own checks; the rest and the verdict do not wait', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { checks } = app.wiring.context;
    await mutate(app, [{ op: 'hangProvider', port: 'devices' }]);
    const running: CheckItem = {
      id: 'trackir',
      type: 'process.running',
      title: 'TrackIR',
      required: true,
      params: { name: 'TrackIR5.exe' },
    };
    const optional: CheckItem = { ...PEDALS, id: 'optional', required: false };
    const arrived: string[] = [];
    vi.useFakeTimers();
    const pending = runChecks(profileOf([PEDALS, running, optional]), checks, app.ctx, {
      timeoutMs: 5000,
      onResult: (r) => arrived.push(`${r.itemId}:${r.status}`),
    });
    await vi.advanceTimersByTimeAsync(100);
    // The app check answered long before the hung ones time out.
    expect(arrived).toEqual(['trackir:pass']);
    await vi.advanceTimersByTimeAsync(5000);
    const report = await pending;
    expect(report.results.map((r) => [r.itemId, r.status, r.summary])).toEqual([
      ['pedals', 'error', 'Timed out after 5 s'],
      ['trackir', 'pass', 'Running'],
      ['optional', 'error', 'Timed out after 5 s'],
    ]);
    // A required item that timed out counts as not ready; an optional one does not.
    expect(report).toMatchObject({ ready: false, failed: 1, errors: 2 });

    await mutate(app, [{ op: 'hangProvider', port: 'devices', hang: false }]);
    vi.useRealTimers();
    expect((await runChecks(profileOf([PEDALS]), checks, app.ctx)).ready).toBe(true);
    for (const port of ['displays', 'processes', 'services', 'audio'] as const) {
      await mutate(app, [{ op: 'hangProvider', port }]);
    }
    const hung = [
      app.ports.displays.read(),
      app.ports.processes.list(),
      app.ports.services.list(),
      app.ports.services.get('HidHide'),
      app.ports.audio.read(),
    ];
    const answered = await Promise.race([
      Promise.race(hung).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
    ]);
    expect(answered).toBe(false);
  });
});

describe('Launch says what really happened', () => {
  const DCS = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe';

  it('a program that Windows refuses to start, or that never shows up, is never reported as launched', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile(profileOf([], { launch: { exe: DCS, args: [] } }));
    const f = fly();
    await mutate(app, [{ op: 'failProcessStart', name: 'DCS.exe' }]);
    expect(await f.launch('p')).toMatchObject({
      value: {
        outcome: 'failed',
        message: `Could not start ${DCS}. Access is denied.`,
        minimize: false,
      },
    });
    await mutate(app, [{ op: 'failProcessStart', name: 'dcs.exe', mode: 'neverRuns' }]);
    expect(await f.launch('p')).toMatchObject({
      value: {
        outcome: 'failed',
        message: 'Started DCS.exe but it is not running after 30 s',
      },
    });
    await mutate(app, [{ op: 'failProcessStart', name: 'DCS.exe', mode: 'off' }]);
    expect(await f.launch('p')).toMatchObject({
      value: { outcome: 'launched', message: 'Launched DCS.exe' },
    });
  });

  it('a game started through steam.exe is handed to Steam: no wait for Steam to exit, and Steam is never "the game"', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const steam = path.join(app.ports.folders.programFilesX86(), 'Steam', 'steam.exe');
    await mutate(app, [{ op: 'startProcess', name: 'steam.exe', path: steam }]);
    const running: CheckItem = {
      id: 'game',
      type: 'process.running',
      title: 'DCS',
      required: false,
      params: { name: 'DCS.exe', stopOnStandDown: true },
    };
    await saveProfile(
      profileOf([running], {
        game: 'dcs',
        launch: { exe: steam, args: ['-applaunch', '223750'] },
      })
    );
    const f = fly();
    expect((await f.profileView('p')).ok && (await f.profileView('p'))).toMatchObject({
      value: { launchLabel: 'DCS World through Steam' },
    });
    // Steam is running, the game is not: that is "not running", whatever Steam does.
    expect(await f.gameStatus('p')).toMatchObject({ value: { running: false, name: 'DCS.exe' } });
    const launched = await f.launch('p');
    expect(launched).toMatchObject({
      value: { outcome: 'launched', message: 'Asked Steam to start DCS F/A-18C' },
    });
    expect(app.ports.processes.started.at(-1)).toMatchObject({
      exe: steam,
      args: ['-applaunch', '223750'],
    });

    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: DCS }]);
    expect(await f.gameStatus('p')).toMatchObject({ value: { running: true, name: 'DCS.exe' } });

    // Stand down leaves the game alone unless asked, and never closes Steam.
    const kept = await f.standDown('p');
    expect(kept.ok && app.ports.processes.closed.map((c) => c.name)).toEqual([]);
    const closed = await f.standDown('p', { closeGame: true });
    expect(closed.ok && app.ports.processes.closed.map((c) => c.name)).toEqual(['DCS.exe']);
    const list = await app.ports.processes.list();
    expect(list.ok && list.value.filter((p) => p.name === 'steam.exe').length).toBeGreaterThan(0);
  });
});

describe('capture: one candidate per program, and game checks only for that game', () => {
  const candidate = (key: string, extra: Partial<CaptureCandidate> = {}): CaptureCandidate => ({
    key,
    group: 'apps',
    title: key,
    selectedByDefault: false,
    check: { type: 'x.y', title: key, required: true, params: {} },
    ...extra,
  });

  it('keeps the specific candidate for a program, selected when either one was', () => {
    const kept = dedupeCandidates([
      candidate('process:fanatecservice.exe', { program: 'FanatecService.exe', generic: true }),
      candidate('process:streamdeck.exe', {
        program: 'StreamDeck.exe',
        generic: true,
        selectedByDefault: true,
      }),
      candidate('process:other.exe', { program: 'Other.exe', generic: true }),
      candidate('racing:app:fanatec', { program: 'fanatecservice.exe', selectedByDefault: true }),
      candidate('stream-deck:running', { covers: ['streamdeck.exe'] }),
      candidate('racing:app:again', { program: 'FanatecService.exe' }),
      candidate('devices:stick'),
    ]);
    expect(kept.map((c) => [c.key, c.selectedByDefault])).toEqual([
      ['process:other.exe', false],
      ['racing:app:fanatec', true],
      // Took over the tick of the generic candidate it replaces.
      ['stream-deck:running', true],
      ['devices:stick', false],
    ]);
  });

  it('on the recorded rig: no program is offered twice, and DCS checks are marked as DCS', async () => {
    app = await wiredApp('racing-fresh');
    const { candidates } = await app.invoke<{ candidates: CaptureCandidate[] }>('profiles:capture');
    const programs = candidates.filter((c) => c.program).map((c) => c.program!.toLowerCase());
    expect(programs.length).toBe(new Set(programs).size);
    const titles = candidates.map((c) => c.title);
    expect(titles).toContain('Fanatec Service');
    expect(titles).not.toContain('FanatecService');
    expect(titles).toContain('Stream Deck app');
    expect(titles).not.toContain('Stream Deck');
    // The Stream Deck app was running and is a known helper: still kept by default.
    expect(candidates.find((c) => c.title === 'Stream Deck app')?.selectedByDefault).toBe(true);
    const dcs = candidates.filter((c) => c.key.startsWith('dcs'));
    expect(dcs.length).toBeGreaterThan(2);
    expect(dcs.every((c) => c.game === 'dcs')).toBe(true);
  });
});

describe('names the owner gave things, through core', () => {
  it('has no names without a source, survives a failing one, and refuses a second source', async () => {
    const names = new NameRegistry();
    expect(await names.monitors()).toEqual({});
    expect((await names.devices()).nameOf({ vendorId: '4098', productId: 'BEA8' })).toBeUndefined();
    names.provideMonitors(async () => ({ 'id-1': 'MFD left' }));
    names.provideDevices(async () => ({
      nameOf: (d) => (d.productId === 'BEA8' ? 'Stick' : undefined),
    }));
    expect(await names.monitors()).toEqual({ 'id-1': 'MFD left' });
    expect((await names.devices()).nameOf({ vendorId: '4098', productId: 'BEA8' })).toBe('Stick');
    expect(() => names.provideMonitors(async () => ({}))).toThrow(/already provided/);
    expect(() => names.provideDevices(async () => ({ nameOf: () => undefined }))).toThrow(
      /already provided/
    );
    const failing = new NameRegistry();
    failing.provideMonitors(async () => {
      throw new Error('disk');
    });
    failing.provideDevices(async () => {
      throw new Error('disk');
    });
    expect(await failing.monitors()).toEqual({});
    expect((await failing.devices()).nameOf({ vendorId: '1', productId: '2' })).toBeUndefined();
  });

  it('the name given on the Monitors page is what every feature gets', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const read = await app.ports.displays.read();
    const mfd = read.ok ? read.value.displays.find((d) => d.name === 'USB_Monitor')! : undefined;
    await app.invoke('displays:setName', { id: mfd!.id, name: 'MFD left' });
    expect(await app.wiring.context.names.monitors()).toEqual({ [mfd!.id]: 'MFD left' });
  });
});
