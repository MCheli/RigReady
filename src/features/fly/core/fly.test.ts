import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckItem, LaunchAction, Profile } from '../../../core/profile/schema';
import { err, ok } from '../../../core/result';
import { NodeShell } from '../../../platform/node';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { Fly, type FlyEvents } from './fly';
import { ProfileWatcher } from './watch';

let app: WiredApp;
afterEach(async () => {
  vi.useRealTimers();
  await app?.cleanup();
});

const TRACKIR = 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe';
const SIMAPPPRO = 'C:\\Users\\User\\AppData\\Local\\Programs\\SimAppPro\\SimAppPro.exe';

type Event = { kind: keyof FlyEvents; payload: Record<string, unknown> };

function fly(options: ConstructorParameters<typeof Fly>[2] = {}): { fly: Fly; events: Event[] } {
  const events: Event[] = [];
  const record =
    (kind: keyof FlyEvents) =>
    (payload: object): void => {
      events.push({ kind, payload: payload as Record<string, unknown> });
    };
  return {
    fly: new Fly(
      app.wiring.context,
      {
        result: record('result'),
        progress: record('progress'),
        launchProgress: record('launchProgress'),
      },
      // Polls and delays move the test clock instead of waiting.
      {
        sleep: async (ms) => app.clock.advance(ms),
        timer: () => new Promise(() => {}),
        ...options,
      }
    ),
    events,
  };
}

async function saveProfile(
  partial: Partial<Profile> & { id: string; name: string }
): Promise<Profile> {
  const profile: Profile = {
    schemaVersion: 1,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    checks: [],
    extensions: {},
    ...partial,
  };
  const saved = await app.wiring.context.profiles.save(profile);
  if (!saved.ok) throw new Error(saved.error.message);
  return saved.value;
}

const app_ = (name: string, exe: string, extra: Partial<CheckItem> = {}): CheckItem => ({
  id: name.toLowerCase(),
  type: 'process.running',
  title: name,
  required: true,
  params: { name: path.win32.basename(exe) },
  remediation: { type: 'process.launch', params: { exe, args: [] } },
  ...extra,
});

describe('opening the Fly screen', () => {
  it('opens on the last used setup and draws its checklist before checking', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({ id: 'dcs-uh-1h', name: 'DCS UH-1H', game: 'dcs' });
    const { fly: f } = fly();
    await app.wiring.context.profiles.setLastProfileId('dcs-uh-1h');
    const state = await f.state();
    expect(state.ok && state.value).toMatchObject({
      activeProfileId: 'dcs-uh-1h',
      active: { name: 'DCS UH-1H', items: [] },
      profiles: [
        { id: 'dcs-f-a-18c', gameName: 'DCS World' },
        { id: 'dcs-uh-1h', gameName: 'DCS World' },
      ],
    });
    expect(state.ok && state.value.notice).toBeUndefined();
  });

  it('falls back to the most recently changed setup, with a one-line notice, when the last one is gone or broken', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({ id: 'newer', name: 'Newer' });
    const profiles = app.wiring.context.profiles;
    await profiles.setLastProfileId('gone');
    const { fly: f } = fly();
    const gone = await f.state();
    expect(gone.ok && gone.value).toMatchObject({
      activeProfileId: 'newer',
      notice: 'The setup you used last ("gone") no longer exists. Showing "Newer" instead.',
    });

    await fs.writeFile(profiles.fileFor('broken'), 'name: [unclosed');
    await profiles.setLastProfileId('broken');
    const broken = await f.state();
    expect(broken.ok && broken.value).toMatchObject({
      activeProfileId: 'newer',
      notice: expect.stringContaining('The setup you used last ("broken") could not be opened'),
      invalid: [{ id: 'broken', message: 'The profile file broken.yaml is not valid YAML.' }],
    });
  });

  it('keeps the last version that loaded when a hand edit breaks the active setup', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly: f } = fly();
    const before = await f.check('dcs-f-a-18c');
    expect(before.ok).toBe(true);
    const file = app.wiring.context.profiles.fileFor('dcs-f-a-18c');
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replace('name: DCS F/A-18C', 'name: 42: x:')
    );
    const state = await f.state();
    expect(state.ok && state.value).toMatchObject({
      activeProfileId: 'dcs-f-a-18c',
      active: { name: 'DCS F/A-18C', problem: expect.stringContaining('not valid YAML') },
    });
    const view = await f.profileView('dcs-f-a-18c');
    expect(view.ok && view.value.problem).toBeDefined();
    // Checks still run on the kept version.
    expect((await f.check('dcs-f-a-18c')).ok).toBe(true);
  });

  it('with no setups there is nothing active', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const state = await fly().fly.state();
    expect(state.ok && state.value).toEqual({ profiles: [], invalid: [] });
  });
});

describe('checks', () => {
  it('streams results of a tagged run, and a newer run silences an older, slower one', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({ id: 'uh', name: 'UH-1H', checks: [app_('TrackIR', TRACKIR)] });
    const { fly: f, events } = fly();
    // The process list answers only when the test says so: a slow provider.
    let release: (() => void) | undefined;
    const list = app.ports.processes.list.bind(app.ports.processes);
    app.ports.processes.list = () =>
      new Promise((resolve) => (release = () => void list().then(resolve)));
    const slow = f.check('uh', 'run-old');
    await vi.waitFor(() => expect(release).toBeDefined());
    app.ports.processes.list = list;
    const switched = await f.check('dcs-f-a-18c', 'run-new');
    expect(switched.ok && switched.value.results).toHaveLength(16);
    const before = events.length;
    release!();
    const old = await slow;
    // The caller still gets its own answer...
    expect(old.ok && old.value.profileId).toBe('uh');
    // ...but nothing from the old run is pushed under the new one.
    expect(events.slice(before)).toEqual([]);
    expect(events.every((e) => e.payload['runId'] === 'run-new')).toBe(true);
    expect(events.filter((e) => e.kind === 'result')).toHaveLength(16);
  });

  it('one hung check times out on its own; the others and the verdict do not wait for it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await saveProfile({
      id: 'hung',
      name: 'Hung',
      checks: [
        app_('TrackIR', TRACKIR),
        {
          id: 'svc',
          type: 'service.running',
          title: 'HidHide',
          required: true,
          params: { name: 'HidHide' },
        },
        app_('SimAppPro', SIMAPPPRO, { id: 'sap', required: false, timeoutSeconds: 2 }),
      ],
    });
    app.ports.processes.list = () => new Promise(() => {});
    const { fly: f, events } = fly();
    const ids = (): string[] =>
      events.map((e) => (e.payload['result'] as { itemId: string }).itemId);
    // Files are read for real; let that I/O happen without moving the fake clock.
    const until = async (done: () => boolean): Promise<void> => {
      const start = Date.now();
      while (!done() && Date.now() - start < 5000) await new Promise((r) => setImmediate(r));
    };
    let finished = false;
    const pending = f.check('hung', 'run').finally(() => (finished = true));
    await until(() => ids().length > 0);
    // The service check is in already; the clock has not moved.
    expect(ids()).toEqual(['svc']);
    await vi.advanceTimersByTimeAsync(2000);
    await until(() => ids().length > 1);
    expect(ids()).toEqual(['svc', 'sap']);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    const report = await pending;
    expect(report.ok && report.value.results.map((r) => [r.itemId, r.status, r.summary])).toEqual([
      ['trackir', 'error', 'Timed out after 5 s'],
      ['svc', 'pass', 'Running'],
      ['sap', 'error', 'Timed out after 2 s'],
    ]);
    // A required item in error is not ready.
    expect(report.ok && report.value).toMatchObject({
      ready: false,
      failed: 1,
      warnings: 1,
      errors: 2,
    });
  });

  it('re-checks one item without touching the others', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly: f } = fly();
    const first = await f.check('dcs-f-a-18c');
    expect(first.ok && first.value.results.find((r) => r.itemId === 'c13')?.status).toBe('fail');
    await mutate(app, [{ op: 'startProcess', name: 'TrackIR5.exe', path: TRACKIR }]);
    app.clock.advance(5000);
    const again = await f.checkItem('dcs-f-a-18c', 'c13');
    expect(again.ok && again.value).toMatchObject({
      status: 'pass',
      checkedAt: '2026-10-03T12:00:05.000Z',
    });
    expect(await f.checkItem('dcs-f-a-18c', 'nope')).toMatchObject({ ok: false });
    expect(await f.checkItem('missing', 'c13')).toMatchObject({ ok: false });
  });

  it('a fix counts only when its check passes afterwards', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly: f } = fly();
    const fixed = await f.fix('dcs-f-a-18c', 'c13', false);
    expect(fixed.ok && fixed.value).toMatchObject({
      step: { ok: true, message: 'Started TrackIR5.exe' },
      result: { status: 'pass' },
    });
    // Nothing to fix on a device: honest, and no change.
    const device = await f.fix('dcs-f-a-18c', 'c3', false);
    expect(device.ok && device.value.step).toMatchObject({
      ok: false,
      message: 'This item has no fix.',
    });
    expect(await f.fix('dcs-f-a-18c', 'nope', false)).toMatchObject({ ok: false });
  });
});

describe('Make ready', () => {
  it('fixes monitors first, then config files, then apps in the setup order, and verifies each', async () => {
    app = await wiredApp('flying-mfd-rotated', { files: ['Saved Games/DCS/**'] });
    const optionsCheck: CheckItem = {
      id: 'opt',
      type: 'file.exists',
      title: 'options.lua',
      required: true,
      params: { path: '{DCS_USER}/Config/options.lua' },
      remediation: { type: 'file.restore', params: { path: '{DCS_USER}/Config/options.lua' } },
    };
    // A known-good copy to restore from.
    await app.invoke('profiles:prepareFix', optionsCheck.remediation);
    const order: string[] = [];
    const ports = app.ports;
    const apply = ports.displays.apply.bind(ports.displays);
    ports.displays.apply = (t) => (order.push('display'), apply(t));
    const start = ports.processes.start.bind(ports.processes);
    ports.processes.start = (t) => (order.push(`start ${path.win32.basename(t.exe)}`), start(t));
    const write = ports.files.write.bind(ports.files);
    ports.files.write = (file, content, options) => {
      if (/options\.lua$/.test(file)) order.push('restore');
      return write(file, content, options);
    };
    const base = (await app.wiring.context.profiles.get('dcs-f-a-18c')) as {
      ok: true;
      value: Profile;
    };
    await saveProfile({
      ...base.value,
      checks: [
        app_('SimAppPro', SIMAPPPRO, { id: 'sap' }),
        app_('TrackIR', TRACKIR),
        optionsCheck,
        ...base.value.checks.filter((c) => c.type === 'display.layout'),
      ],
    });
    await mutate(app, [
      { op: 'stopProcess', name: 'TrackIR5.exe' },
      { op: 'stopProcess', name: 'SimAppPro.exe' },
      { op: 'removeFile', path: 'Saved Games/DCS/Config/options.lua' },
    ]);
    const { fly: f, events } = fly();
    const made = await f.makeReady('dcs-f-a-18c', { runId: 'r' });
    expect(order).toEqual(['display', 'restore', 'start SimAppPro.exe', 'start TrackIR5.exe']);
    expect(made.ok && made.value.report.ready).toBe(true);
    expect(made.ok && made.value.steps.every((s) => s.ok)).toBe(true);
    // Progress for each fix: pending, running, then done.
    const states = events
      .filter((e) => e.payload['itemId'] === 'trackir')
      .map((e) => e.payload['state']);
    expect(states).toEqual(['pending', 'running', 'done']);
    await app.invoke('displays:keep');
  });

  it('asks before a fix that runs a program: declined is "skipped by you", approved runs, a failure does not stop the rest', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const script = path.join(app.home, 'fix.cmd');
    await fs.writeFile(script, '');
    const scriptFix = (id: string): CheckItem => ({
      id,
      type: 'service.running',
      title: `Service ${id}`,
      required: true,
      params: { name: `Missing${id}` },
      remediation: { type: 'script.run', params: { exe: '{USER}/fix.cmd', args: [id] } },
    });
    app.ports.shell.scripts.push({
      match: { exe: 'fix.cmd', args: ['b'] },
      result: { code: 1, stdout: 'no', stderr: '' },
    });
    await saveProfile({
      id: 'p',
      name: 'P',
      checks: [scriptFix('a'), scriptFix('b'), scriptFix('c'), app_('TrackIR', TRACKIR)],
    });
    const { fly: f } = fly();
    const made = await f.makeReady('p', { approved: ['b', 'c'] });
    expect(
      made.ok && made.value.steps.map((s) => [s.itemId, s.ok, s.skipped ?? false, s.message])
    ).toEqual([
      ['trackir', true, false, 'Started TrackIR5.exe'],
      ['a', false, true, 'Skipped by you'],
      ['b', false, false, 'fix.cmd exited with code 1 no'],
      // The script ran, but the service is still not there: not reported as fixed.
      ['c', false, false, 'Ran fix.cmd, but the check still fails: Not installed'],
    ]);
    expect(app.ports.shell.calls.map((c) => c.args)).toEqual([['b'], ['c']]);
    // The tray cannot ask, so it never runs such a fix.
    const fromTray = await app.invoke<{
      steps: { itemId: string; skipped?: boolean; message: string }[];
    }>('fly:makeReady', { profileId: 'p' });
    expect(fromTray.steps.find((s) => s.itemId === 'a')).toMatchObject({
      skipped: true,
      message: 'Not run: this fix runs a program, so it needs your OK in the RigReady window.',
    });
  });
});

describe('Launch', () => {
  const DCS = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe';

  it('resolves path variables and passes every argument as one literal element', async () => {
    app = await wiredApp('flying-pedals-unplugged', { files: [] });
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: {
        exe: '{PROGRAM_FILES_X86}/Steam/steamapps/common/DCSWorld/bin/DCS.exe',
        args: ['--force_enable_VR', 'x && del *'],
        cwd: '{PROGRAM_FILES_X86}/Steam',
      },
    });
    const { fly: f } = fly();
    const launched = await f.launch('p');
    expect(launched.ok && launched.value).toMatchObject({
      outcome: 'launched',
      message: 'Launched DCS.exe',
      minimize: true,
    });
    const programs = app.ports.folders.programFilesX86();
    expect(app.ports.processes.started).toEqual([
      {
        exe: path.join(programs, 'Steam', 'steamapps', 'common', 'DCSWorld', 'bin', 'DCS.exe'),
        args: ['--force_enable_VR', 'x && del *'],
        cwd: path.join(programs, 'Steam'),
      },
    ]);
  });

  it('launches through Steam with steam://rungameid/<id>', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({ id: 'p', name: 'P', steamAppId: '223750' });
    const launched = await fly().fly.launch('p');
    expect(launched.ok && launched.value).toMatchObject({
      outcome: 'launched',
      message: 'Asked Steam to start P',
    });
    const [started] = app.ports.processes.started;
    // The registry spells Steam's folder in lower case.
    expect(started!.exe.toLowerCase()).toBe(
      path.join(app.ports.folders.programFilesX86(), 'Steam', 'steam.exe').toLowerCase()
    );
    expect(started!.args).toEqual(['steam://rungameid/223750']);
  });

  it('says where it looked when the game is not there, and never claims a launch it did not see', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const missing = path.join(app.home, 'Games', 'DCS.exe');
    await saveProfile({ id: 'p', name: 'P', launch: { exe: missing, args: [] } });
    const shell = new NodeShell();
    app.ports.processes.start = (t) => shell.launch(t.exe, t.args);
    const { fly: f } = fly();
    expect(
      (await f.launch('p')).ok &&
        ((await f.launch('p')) as { value: { message: string } }).value.message
    ).toBe(`DCS.exe not found at ${missing}`);
    // Started, but the game never shows up within 30 s.
    app.ports.processes.start = async () => ok({ pid: 1 });
    const gone = await f.launch('p');
    expect(gone.ok && gone.value).toMatchObject({
      outcome: 'failed',
      message: 'Started DCS.exe but it is not running after 30 s',
      minimize: false,
    });
    app.ports.processes.start = async () => err('shell.launch', 'Could not start.', 'EACCES');
    expect(await f.launch('p')).toMatchObject({
      value: { outcome: 'failed', message: 'Could not start. EACCES' },
    });
    await saveProfile({ id: 'q', name: 'Q', launch: { exe: '{NOPE}/x.exe', args: [] } });
    expect(await f.launch('q')).toMatchObject({
      value: { outcome: 'failed', message: 'Unknown path variable {NOPE}.' },
    });
    expect(await f.launch('none')).toMatchObject({ ok: false });
  });

  const action = (
    id: string,
    title: string,
    type: string,
    params: Record<string, unknown>,
    extra: Partial<LaunchAction> = {}
  ): LaunchAction => ({
    id,
    title,
    type,
    params,
    continueOnError: true,
    delaySeconds: 0,
    ...extra,
  });

  it('runs pre-launch actions in order before the game, and post-launch ones at their delay after it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const warmup = path.join(app.home, 'warmup.cmd');
    await fs.writeFile(warmup, '');
    const order: string[] = [];
    const start = app.ports.processes.start.bind(app.ports.processes);
    app.ports.processes.start = (t) => (
      order.push(`start ${path.win32.basename(t.exe)} @${app.clock.now().getTime()}`),
      start(t)
    );
    const run = app.ports.shell.run.bind(app.ports.shell);
    app.ports.shell.run = (exe, args) => (
      order.push(`run ${path.win32.basename(exe)}`),
      run(exe, args)
    );
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      actions: {
        preLaunch: [
          action('a1', 'Start VoiceAttack', 'process.launch', {
            exe: 'C:\\VoiceAttack\\VoiceAttack.exe',
          }),
          action('a2', 'Warm up', 'script.run', {
            exe: '{USER}/warmup.cmd',
            requiresConfirmation: false,
          }),
        ],
        postLaunch: [
          action(
            'a3',
            'Start SRS',
            'process.launch',
            { exe: 'C:\\SRS\\SR-ClientRadio.exe' },
            { delaySeconds: 20 }
          ),
        ],
        standDown: [],
      },
    });
    const { fly: f, events } = fly();
    const t0 = app.clock.now().getTime();
    const launched = await f.launch('p', { runId: 'L' });
    expect(launched.ok && launched.value).toMatchObject({
      outcome: 'launched',
      postLaunchPending: 1,
    });
    await vi.waitFor(() => expect(order).toHaveLength(4));
    expect(order).toEqual([
      `start VoiceAttack.exe @${t0}`,
      'run warmup.cmd',
      `start DCS.exe @${t0}`,
      `start SR-ClientRadio.exe @${t0 + 20_000}`,
    ]);
    await vi.waitFor(() =>
      expect(events.filter((e) => e.payload['id'] === 'a3').map((e) => e.payload['state'])).toEqual(
        ['pending', 'running', 'done']
      )
    );
  });

  it('a failing post-launch step is reported and never touches the game', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      actions: {
        preLaunch: [],
        postLaunch: [
          action('p1', 'Broken helper', 'script.run', {
            exe: '{USER}/missing.cmd',
            requiresConfirmation: false,
          }),
          action(
            'p2',
            'Start SRS',
            'process.launch',
            { exe: 'C:\\SRS\\SR-ClientRadio.exe' },
            { delaySeconds: 5 }
          ),
        ],
        standDown: [],
      },
    });
    const { fly: f, events } = fly();
    const launched = await f.launch('p', { runId: 'L' });
    expect(launched.ok && launched.value.outcome).toBe('launched');
    await vi.waitFor(() =>
      expect(
        events.filter((e) => e.payload['id'] === 'p2').map((e) => e.payload['state'])
      ).toContain('done')
    );
    expect(
      events.find((e) => e.payload['id'] === 'p1' && e.payload['state'] === 'failed')?.payload
    ).toMatchObject({
      phase: 'postLaunch',
      message: expect.stringMatching(/^Script not found: /),
    });
    // The game was neither stopped nor closed, and the next step still ran.
    expect(app.ports.processes.closed).toEqual([]);
    expect(await f.gameStatus('p')).toEqual(ok({ running: true, name: 'DCS.exe' }));
  });

  it('a failing step that must not fail pauses the launch; "Launch anyway" goes on after it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await fs.writeFile(path.join(app.home, 'check.cmd'), '');
    app.ports.shell.scripts.push({
      match: { exe: 'check.cmd', args: [] },
      result: { code: 1, stdout: 'TrackIR not found', stderr: '' },
    });
    const script = (continueOnError: boolean) =>
      action(
        's',
        'Check TrackIR',
        'script.run',
        { exe: '{USER}/check.cmd', requiresConfirmation: false },
        { continueOnError }
      );
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      actions: { preLaunch: [script(false)], postLaunch: [], standDown: [] },
    });
    const { fly: f } = fly();
    const paused = await f.launch('p');
    expect(paused.ok && paused.value).toMatchObject({
      outcome: 'paused',
      pausedAt: 0,
      message: '"Check TrackIR" failed: check.cmd exited with code 1',
      steps: [{ itemId: 's', ok: false, output: 'TrackIR not found' }],
    });
    expect(app.ports.processes.started).toEqual([]);
    const resumed = await f.launch('p', { resumeAfter: 0 });
    expect(resumed.ok && resumed.value.outcome).toBe('launched');
    expect(app.ports.shell.calls).toHaveLength(1);

    // With continueOnError the failure is noted and the launch goes on.
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      actions: { preLaunch: [script(true)], postLaunch: [], standDown: [] },
    });
    const goes = await f.launch('p');
    expect(goes.ok && goes.value).toMatchObject({
      outcome: 'launched',
      steps: [
        { itemId: 's', ok: false, phase: 'preLaunch' },
        { itemId: 'game', ok: true, phase: 'launch' },
      ],
    });
  });

  it('an action that hangs is timed out; waiting and not waiting for a script are honoured', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await fs.writeFile(path.join(app.home, 'go.cmd'), '');
    const hung = {
      type: 'test.hang',
      label: 'Hang',
      order: 1,
      params: (await import('zod')).z.object({}),
      describe: () => 'Hang',
      run: () => new Promise<never>(() => {}),
    };
    app.wiring.context.checks.registerRemediation(hung);
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      actions: {
        preLaunch: [
          action('h', 'Hangs', 'test.hang', {}, { timeoutSeconds: 3 }),
          action('w', 'Wait', 'script.run', { exe: '{USER}/go.cmd', requiresConfirmation: false }),
          action(
            'n',
            'No wait',
            'script.run',
            { exe: '{USER}/go.cmd', requiresConfirmation: false },
            { waitForCompletion: false }
          ),
          action('c', 'Needs OK', 'script.run', { exe: '{USER}/go.cmd' }),
          action('u', 'Unknown', 'from.the.future', {}),
          action('i', 'Info', 'instructions.show', { text: 'Read this' }),
        ],
        postLaunch: [],
        standDown: [],
      },
    });
    // Only the hung action's timeout (3 s + 1 s grace) ever runs out.
    const { fly: f } = fly({
      timer: (ms) => (ms === 4000 ? Promise.resolve() : new Promise(() => {})),
    });
    const launched = await f.launch('p');
    expect(launched.ok && launched.value.steps.map((s) => [s.itemId, s.ok, s.message])).toEqual([
      ['h', false, 'Timed out after 3 s'],
      ['w', true, 'Ran go.cmd'],
      ['n', true, 'Started go.cmd'],
      ['c', false, 'Not run: it needs your OK, and it was not given.'],
      ['u', false, 'Action type "from.the.future" is not available in this version of RigReady.'],
      ['i', true, 'Instructions only; nothing to run.'],
      ['game', true, 'Launched DCS.exe'],
    ]);
  });
});

describe('Stand down', () => {
  it('closes only the apps RigReady started this session, politely, and says how many', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    await mutate(app, [{ op: 'stopProcess', name: 'SimAppPro.exe' }]);
    await saveProfile({
      id: 'p',
      name: 'P',
      checks: [
        app_('TrackIR', TRACKIR),
        app_('SimAppPro', SIMAPPPRO, { id: 'sap' }),
        // Running already, not started by RigReady: left alone.
        app_('Stream Deck', 'C:\\Program Files\\Elgato\\StreamDeck\\StreamDeck.exe', { id: 'sd' }),
      ],
    });
    const { fly: f } = fly();
    const made = await f.makeReady('p');
    expect(made.ok && made.value.report.ready).toBe(true);
    const down = await f.standDown('p');
    expect(down.ok && down.value.headline).toBe('Closed 2 apps');
    expect(app.ports.processes.closed.map((c) => [c.name, c.options])).toEqual([
      ['TrackIR5.exe', { waitMs: 10_000, force: false }],
      ['SimAppPro.exe', { waitMs: 10_000, force: false }],
    ]);
    const running = await app.ports.processes.list();
    expect(running.ok && running.value.some((p) => p.name === 'StreamDeck.exe')).toBe(true);
    expect(down.ok && down.value.steps.at(-1)).toMatchObject({
      skipped: true,
      message: 'No desk layout is chosen in Settings, so the monitors were left as they are',
    });
  });

  it('never closes the game unless asked, closes what launch actions started, and runs its own actions', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await fs.writeFile(path.join(app.home, 'after.cmd'), '');
    const DCS = 'C:\\Games\\DCS\\bin\\DCS.exe';
    await saveProfile({
      id: 'p',
      name: 'P',
      launch: { exe: DCS, args: [] },
      checks: [
        app_('DCS', DCS, { id: 'game', params: { name: 'DCS.exe', stopOnStandDown: true } }),
      ],
      actions: {
        preLaunch: [
          {
            id: 'va',
            title: 'VoiceAttack',
            type: 'process.launch',
            params: { exe: 'C:\\VA\\VoiceAttack.exe' },
            continueOnError: true,
            delaySeconds: 0,
          },
        ],
        postLaunch: [],
        standDown: [
          {
            id: 'sd',
            title: 'Tidy up',
            type: 'script.run',
            params: { exe: '{USER}/after.cmd' },
            continueOnError: true,
            delaySeconds: 0,
          },
        ],
      },
    });
    const { fly: f } = fly();
    expect(await f.gameStatus('p')).toEqual(ok({ running: false, name: 'DCS.exe' }));
    await f.launch('p');
    expect(await f.gameStatus('p')).toEqual(ok({ running: true, name: 'DCS.exe' }));
    const down = await f.standDown('p');
    expect(down.ok && down.value.steps.map((s) => s.message)).toEqual([
      'Closed VoiceAttack.exe',
      'Ran after.cmd',
      'No desk layout is chosen in Settings, so the monitors were left as they are',
    ]);
    expect(await f.gameStatus('p')).toEqual(ok({ running: true, name: 'DCS.exe' }));
    const withGame = await f.standDown('p', { closeGame: true });
    expect(withGame.ok && withGame.value.steps[0]).toMatchObject({
      ok: true,
      message: 'Closed DCS.exe',
    });
    expect(await f.gameStatus('p')).toEqual(ok({ running: false, name: 'DCS.exe' }));
    // A program that will not close is listed, not hidden.
    app.ports.processes.stubborn.add('dcs.exe');
    await f.launch('p');
    const stuck = await f.standDown('p', { closeGame: true });
    expect(stuck.ok && stuck.value.headline).toBe('Closed 1 app · 1 step need attention');
  });
});

describe('the rest', () => {
  it('Mark verified stores the new version in the setup and re-checks', async () => {
    app = await wiredApp('flying-all-good', { files: ['Program Files (x86)/Steam/**'] });
    await saveProfile({
      id: 'p',
      name: 'P',
      checks: [
        {
          id: 'g',
          type: 'game.updated',
          title: 'DCS',
          required: false,
          params: { game: 'dcs', verifiedVersion: 'build 1' },
        },
      ],
    });
    const { fly: f } = fly();
    const result = await f.acknowledge('p', 'g');
    expect(result.ok && result.value).toMatchObject({
      status: 'pass',
      summary: 'DCS World build 25625823, verified',
    });
    const saved = await app.wiring.context.profiles.get('p');
    expect(saved.ok && saved.value.checks[0]!.params).toEqual({
      game: 'dcs',
      verifiedVersion: 'build 25625823',
    });
    expect(await f.acknowledge('dcs-f-a-18c', 'c1')).toMatchObject({
      ok: false,
      error: { code: 'fly.noAcknowledge' },
    });
  });

  it('remembers whether to hide after Launch', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    expect(await app.invoke('fly:preferences')).toEqual({ minimizeOnLaunch: true });
    expect(await app.invoke('fly:setPreferences', { minimizeOnLaunch: false })).toEqual({
      minimizeOnLaunch: false,
    });
    expect(await app.invoke('fly:launch', { profileId: 'dcs-f-a-18c' })).toMatchObject({
      minimize: false,
    });
  });

  it('notices profile files changed, added or removed on disk', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const seen: string[][] = [];
    const profiles = app.wiring.context.profiles;
    const watcher = new ProfileWatcher(
      app.ports.files,
      profiles.dir,
      (ids) => seen.push(ids),
      60_000
    );
    await watcher.start();
    expect(await watcher.poll()).toEqual([]);
    const file = profiles.fileFor('dcs-f-a-18c');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')) + '\n# edited\n');
    await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
    await fs.writeFile(profiles.fileFor('new-one'), 'x');
    expect(await watcher.poll()).toEqual(['dcs-f-a-18c', 'new-one']);
    await fs.rm(profiles.fileFor('new-one'));
    expect(await watcher.poll()).toEqual(['new-one']);
    expect(seen).toEqual([['dcs-f-a-18c', 'new-one'], ['new-one']]);
    watcher.stop();
    expect(await app.invoke('fly:watch')).toEqual({ watching: true });
  });
});
