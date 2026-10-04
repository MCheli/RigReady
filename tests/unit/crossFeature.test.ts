/**
 * Behaviour that crosses feature boundaries: the Shell port's environment and hidden
 * options, what scripts are told about the setup, the scenario mutations that plug a
 * device in, hang a provider or make a program fail to start, and launching through Steam.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dedupeCandidates, fixItem, runChecks } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import { NameRegistry } from '../../src/core/names';
import {
  CHECK_GROUPS,
  GROUP_TITLES,
  type CheckItem,
  type Profile,
} from '../../src/core/profile/schema';
import { Fly } from '../../src/features/fly/core/fly';
import { applyMutations } from '../../src/platform/fake/scenario';
import {
  batchArgumentProblem,
  launchSpawnOptions,
  NodeShell,
  programStart,
  runSpawnOptions,
} from '../../src/platform/node';
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

describe('Shell: batch files and PowerShell scripts', () => {
  it('starts a batch file through cmd.exe and a PowerShell script through powershell.exe, programs directly', () => {
    expect(programStart('C:\\Tools\\a.exe', ['x y'])).toEqual({
      exe: 'C:\\Tools\\a.exe',
      args: ['x y'],
    });
    expect(programStart('C:\\Scripts\\go.ps1', ['-Name', 'a b'])).toEqual({
      exe: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\Scripts\\go.ps1',
        '-Name',
        'a b',
      ],
    });
    const batch = programStart('C:\\My Scripts\\go.CMD', ['a & b'], { ComSpec: 'C:\\cmd.exe' });
    expect(batch).toMatchObject({ exe: 'C:\\cmd.exe', verbatim: true });
    expect(batch.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    // Everything cmd.exe would act on is escaped; the whole line is one quoted argument.
    expect(batch.args[3]).toBe('"C:\\My^ Scripts\\go.CMD ^"a^ ^&^ b^""');
    expect(batchArgumentProblem('go.cmd', ['fine', 'a "quoted" b'])).toContain('double quote');
    expect(batchArgumentProblem('go.bat', ['two\nlines'])).toContain('line break');
    expect(batchArgumentProblem('go.exe', ['a "quoted" b'])).toBeUndefined();
    expect(batchArgumentProblem('go.cmd', ['a & b', '%PATH%'])).toBeUndefined();
  });

  it('a real batch file gets every argument as one literal value, and its environment and exit code come through', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-test-'));
    try {
      const script = path.join(dir, 'show args.cmd');
      // Hands its arguments on to a program that prints them exactly as received.
      await fs.writeFile(
        script,
        '@echo off\r\n"%RR_NODE%" -e "console.log(JSON.stringify([process.env.RIGREADY_PROFILE_NAME, ...process.argv.slice(1)]))" %*\r\nexit /b 3\r\n'
      );
      const args = ['a b & echo INJECTED', '%PATH% ^ | > x <y (z) !q!', 'trailing\\', '', 'plain'];
      const shell = new NodeShell();
      const result = await shell.run(script, args, {
        env: {
          RR_NODE: process.execPath,
          ELECTRON_RUN_AS_NODE: '1',
          RIGREADY_PROFILE_NAME: 'F/A-18C & friends',
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.code).toBe(3);
      expect(result.value.stderr).toBe('');
      expect(JSON.parse(result.value.stdout)).toEqual(['F/A-18C & friends', ...args]);
      // An argument that could end the quoting inside the batch file is refused, not run.
      expect(await shell.run(script, ['a" & echo X & "b'])).toMatchObject({
        ok: false,
        error: { code: 'shell.argument' },
      });
      expect(await shell.launch(script, ['"'])).toMatchObject({
        ok: false,
        error: { code: 'shell.argument' },
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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

describe('a setup that names the DCS install it uses', () => {
  async function twoInstalls(): Promise<{ beta: string; betaUser: string }> {
    app = await wiredApp('flying-all-good');
    const beta = path.join(app.home, 'Games', 'DCS World OpenBeta');
    const betaUser = path.join(app.ports.folders.savedGames(), 'DCS.openbeta');
    await mutate(app, [
      { op: 'writeFile', path: 'Games/DCS World OpenBeta/bin/DCS.exe', content: '' },
      { op: 'writeFile', path: 'Games/DCS World OpenBeta/dcs_variant.txt', content: 'openbeta' },
      { op: 'writeFile', path: 'Saved Games/DCS.openbeta/Config/only-beta.lua', content: 'x = 1' },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Eagle Dynamics\\DCS World OpenBeta',
        name: 'Path',
        value: { type: 'string', value: beta },
      },
    ]);
    return { beta, betaUser };
  }

  const exists = (id: string, file: string): CheckItem => ({
    id,
    type: 'file.exists',
    title: id,
    required: true,
    params: { path: file },
  });
  const CHECKS = [
    exists('user', '{DCS_USER}/Config/only-beta.lua'),
    exists('install', '{DCS_INSTALL}/bin/DCS.exe'),
  ];

  it('resolves {DCS_INSTALL} and {DCS_USER} to that install for its checks, its launch and its scripts', async () => {
    const { beta, betaUser } = await twoInstalls();
    const { checks, games } = app.wiring.context;
    const installs = await games.get('dcs')!.detect(app.ctx);
    expect(installs.ok && installs.value.map((i) => i.source)).toEqual(['steam', 'standalone']);

    // Without a choice the first install (Steam) is used: the beta-only file is not there.
    const first = await runChecks(profileOf(CHECKS, { game: 'dcs' }), checks, app.ctx);
    expect(first.results.map((r) => r.status)).toEqual(['fail', 'pass']);

    const profile = profileOf(CHECKS, {
      game: 'dcs',
      gameInstall: beta,
      launch: { exe: '{DCS_INSTALL}/bin/DCS.exe', args: [] },
    });
    const chosen = await runChecks(profile, checks, app.ctx);
    expect(chosen.results.map((r) => r.status)).toEqual(['pass', 'pass']);

    await saveProfile(profile);
    const launched = await fly().launch('p');
    expect(launched).toMatchObject({ value: { outcome: 'launched' } });
    expect(app.ports.processes.started.at(-1)!.exe).toBe(path.join(beta, 'bin', 'DCS.exe'));

    const { scriptEnvironment } = await import('../../src/core/scriptEnv');
    const { withProfile } = await import('../../src/core/checks/registry');
    expect(await scriptEnvironment(withProfile(app.ctx, profile), games)).toMatchObject({
      RIGREADY_GAME_PATH: beta,
      RIGREADY_USER_DATA: betaUser,
    });
    // The DCS feature's own checks follow the setup's install too.
    const options: CheckItem = {
      id: 'options',
      type: 'dcs.options',
      title: 'DCS options',
      required: true,
      params: { vr: false },
    };
    const own = await runChecks({ ...profile, checks: [options] }, checks, app.ctx);
    expect(own.results[0]!.summary).toBe(
      'options.lua does not exist yet. DCS creates it the first time it runs.'
    );
    const steam = await runChecks(profileOf([options], { game: 'dcs' }), checks, app.ctx);
    expect(steam.results[0]!.summary).not.toContain('does not exist');
  });

  it('when that install disappears the checks say "DCS install not found" and Launch never starts the other one', async () => {
    const { beta } = await twoInstalls();
    const { checks } = app.wiring.context;
    const installed: CheckItem = {
      id: 'dcs',
      type: 'dcs.install',
      title: 'DCS World installed',
      required: true,
      params: { installDir: beta },
    };
    const profile = profileOf([...CHECKS, installed], {
      game: 'dcs',
      gameInstall: beta,
      launch: { exe: '{DCS_INSTALL}/bin/DCS.exe', args: [] },
    });
    await saveProfile(profile);
    await mutate(app, [{ op: 'removeFile', path: 'Games/DCS World OpenBeta' }]);

    const report = await runChecks(profile, checks, app.ctx);
    expect(report.ready).toBe(false);
    expect(report.results.map((r) => [r.itemId, r.status, r.summary])).toEqual([
      ['user', 'error', 'DCS user folder not found'],
      ['install', 'error', 'DCS install not found'],
      ['dcs', 'fail', 'DCS install not found'],
    ]);
    // The bindings check looks in that install's folder too, and says the same when it is gone.
    const bindings: CheckItem = {
      id: 'bindings',
      type: 'dcs-bindings.deviceIds',
      title: 'DCS bindings',
      required: false,
      params: { aircraft: 'FA-18C_hornet' },
    };
    const bound = await runChecks({ ...profile, checks: [bindings] }, checks, app.ctx);
    expect(bound.results[0]).toMatchObject({ status: 'error', summary: 'DCS install not found' });

    const started = app.ports.processes.started.length;
    expect(await fly().launch('p')).toMatchObject({
      value: { outcome: 'failed', message: `DCS World install not found at ${beta}` },
    });
    expect(app.ports.processes.started).toHaveLength(started);
  });
});

describe('what a script printed is kept with its step', () => {
  it('shows the last 200 lines of a launch action, and of a fix, whether it worked or not', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const script = path.join(app.home, 'Scripts', 'prepare.cmd');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '@echo off');
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\r\n');
    app.ports.shell.scripts.push(
      {
        match: { exe: 'prepare.cmd', args: ['--ok'] },
        result: { code: 0, stdout: lines, stderr: '' },
      },
      {
        match: { exe: 'prepare.cmd', args: ['--fail'] },
        result: { code: 2, stdout: 'starting', stderr: 'it broke' },
      }
    );
    const action = (id: string, arg: string) => ({
      id,
      title: id,
      type: 'script.run',
      params: { exe: '{USER}/Scripts/prepare.cmd', args: [arg], requiresConfirmation: false },
      continueOnError: true,
      delaySeconds: 0,
    });
    await saveProfile(
      profileOf([], {
        launch: {
          exe: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe',
          args: [],
        },
        actions: {
          preLaunch: [action('works', '--ok'), action('fails', '--fail')],
          postLaunch: [],
          standDown: [],
        },
      })
    );
    const launched = await fly().launch('p');
    expect(launched.ok).toBe(true);
    if (!launched.ok) return;
    const [works, fails] = launched.value.steps;
    expect(works).toMatchObject({ ok: true, message: 'Ran prepare.cmd' });
    expect(works!.output!.split('\n')).toHaveLength(200);
    expect(works!.output!.split('\n').at(-1)).toBe('line 250');
    expect(fails).toMatchObject({
      ok: false,
      message: 'prepare.cmd exited with code 2',
      output: 'starting\nit broke',
    });

    // The same for a fix run by Make ready.
    const item: CheckItem = {
      id: 's',
      type: 'script.check',
      title: 'Prepared',
      required: true,
      params: { exe: '{USER}/Scripts/prepare.cmd', args: ['--fail'] },
      remediation: {
        type: 'script.run',
        params: { exe: '{USER}/Scripts/prepare.cmd', args: ['--ok'], requiresConfirmation: false },
      },
    };
    const fixed = await fixItem(profileOf([item]), 's', app.wiring.context.checks, app.ctx);
    expect(fixed!.step.output!.split('\n')).toHaveLength(200);
  });
});

describe('DCS screen setup and the monitors', () => {
  it("calls monitors by the owner's names, and a USB screen moved to another port is still the same screen", async () => {
    app = await wiredApp('flying-fresh', {
      files: [
        'Saved Games/DCS/**',
        'Program Files (x86)/Steam/**',
        'AppData/Roaming/SimAppPro/**',
        'AppData/Local/Programs/SimAppPro/**',
      ],
    });
    const mfds = app.ports.state.displays.filter((d) => d.name === 'USB_Monitor');
    await app.invoke('displays:setName', { id: mfds[0]!.id, name: 'MFD left' });
    type Desktop = { id: string; name: string; usbSerial?: string }[];
    const { setup } = await app.invoke<{ setup: { desktop: Desktop } }>(
      'dcs-setup:importSimAppPro',
      { desktopId: 'current' }
    );
    // The name given on the Monitors page, and what follows the screen to another port.
    expect(setup.desktop.find((d) => d.id === mfds[0]!.id)).toMatchObject({
      name: 'MFD left',
      usbSerial: 'WWIN29320221210163532',
    });
    await app.invoke('dcs-setup:applyScreens', { setup });
    type Overview = { monitorSetup: { problems: string[] } };
    expect((await app.invoke<Overview>('dcs-setup:overview')).monitorSetup.problems).toEqual([]);

    // Plugged into another USB port: a new id, the same screen, nothing to complain about.
    mfds[0]!.id = mfds[0]!.id.replace('2c1ac5a9', '77777777');
    expect((await app.invoke<Overview>('dcs-setup:overview')).monitorSetup.problems).toEqual([]);
    // Turned off, it is missed by the owner's name for it.
    await mutate(app, [
      { op: 'setDisplay', match: { name: 'USB_Monitor', index: 0 }, set: { enabled: false } },
    ]);
    const problems = (await app.invoke<Overview>('dcs-setup:overview')).monitorSetup.problems;
    expect(problems.some((p) => p.includes('MFD left is off or not connected'))).toBe(true);
  });
});

describe('the checklist by kind', () => {
  it('the full Hornet setup has a check in each of the five groups, each with a one-line detail', async () => {
    app = await wiredApp('fly-make-ready-all');
    const state = await app.invoke<{
      activeProfileId: string;
      active: { items: { title: string; group: string }[] };
    }>('fly:state');
    const present = new Set(state.active.items.map((i) => i.group));
    // Shown in this fixed order; a group without checks (Other, here) is not shown at all.
    expect(CHECK_GROUPS.filter((g) => present.has(g))).toEqual([
      'devices',
      'apps',
      'displays',
      'audio',
      'files',
    ]);
    expect(CHECK_GROUPS.map((g) => GROUP_TITLES[g])).toEqual([
      'Devices connected',
      'Apps and services',
      'Monitors',
      'Audio',
      'Config files',
      'Other',
    ]);
    const report = await app.invoke<{
      results: { title: string; group: string; status: string; summary: string }[];
    }>('fly:check', { profileId: state.activeProfileId });
    for (const result of report.results) {
      expect(result.summary.length, result.title).toBeGreaterThan(0);
      expect(result.summary).not.toContain('\n');
    }
    const byGroup = (group: string) =>
      report.results.filter((r) => r.group === group).map((r) => r.status);
    // Devices and audio are fine in this scenario; apps, monitors and files are not.
    expect(byGroup('devices')).toEqual(['pass', 'pass', 'pass']);
    expect(byGroup('audio')).toEqual(['pass']);
    expect(byGroup('apps')).toEqual(['fail', 'fail']);
    expect(byGroup('displays')).toEqual(['fail']);
    expect(byGroup('files')).toEqual(['fail']);
    expect(report.results.find((r) => r.group === 'displays')!.summary).toMatch(
      /rotated 0°, expected 90°|differences/
    );
  });
});
