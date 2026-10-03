import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameRegistry } from '../../../core/games';
import { err, ok } from '../../../core/result';
import { NodeShell } from '../../../platform/node';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  createLaunchRemediation,
  createProcessRunningCheck,
  LaunchParamsSchema,
  pathResolver,
  createProcessCapture,
  ProcessParamsSchema,
  SessionStarts,
} from './processCheck';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const TRACKIR = 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe';
const resolve = pathResolver(new GameRegistry());
const noWait = async (): Promise<void> => {};

function setup(): {
  session: SessionStarts;
  check: ReturnType<typeof createProcessRunningCheck>;
} {
  const session = new SessionStarts();
  return { session, check: createProcessRunningCheck(session, resolve) };
}

const running = async (name: string): Promise<boolean> => {
  const list = await rig.ports.processes.list();
  return list.ok && list.value.some((p) => p.name === name);
};

describe('process.running', () => {
  it('passes when the app runs (case-insensitive) and fails when it does not', async () => {
    const { check } = setup();
    rig = await scenarioRig('flying-all-good', { files: [] });
    expect(await check.run(ProcessParamsSchema.parse({ name: 'trackir5.EXE' }), rig.ctx)).toEqual({
      pass: true,
      summary: 'Running',
    });
    await rig.cleanup();
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    expect(await check.run(ProcessParamsSchema.parse({ name: 'TrackIR5.exe' }), rig.ctx)).toEqual({
      pass: false,
      summary: 'Not running',
    });
    // The process list itself failing is an error, not "not running".
    rig.ports.processes.list = async () => err('process.list', 'Could not list running programs.');
    expect(await check.run(ProcessParamsSchema.parse({ name: 'TrackIR5.exe' }), rig.ctx)).toEqual({
      pass: false,
      error: true,
      summary: 'Could not list running programs.',
    });
  });

  it('optionally requires the exact executable path', async () => {
    const { check } = setup();
    rig = await scenarioRig('flying-all-good', { files: [] });
    const exact = ProcessParamsSchema.parse({ name: 'TrackIR5.exe', path: TRACKIR.toLowerCase() });
    expect((await check.run(exact, rig.ctx)).pass).toBe(true);
    const elsewhere = ProcessParamsSchema.parse({
      name: 'TrackIR5.exe',
      path: 'D:\\Portable\\TrackIR5.exe',
    });
    expect(await check.run(elsewhere, rig.ctx)).toEqual({
      pass: false,
      summary: 'Running from a different folder',
      details: ['Expected D:\\Portable\\TrackIR5.exe', `Running ${TRACKIR}`],
    });
    const unknown = ProcessParamsSchema.parse({ name: 'TrackIR5.exe', path: '{NOPE}/x.exe' });
    expect(await check.run(unknown, rig.ctx)).toMatchObject({ pass: false, error: true });
  });

  it('stand down closes politely: always, never, or only what RigReady started this session', async () => {
    const { check, session } = setup();
    rig = await scenarioRig('flying-all-good', { files: [] });
    const params = (extra: object) => ProcessParamsSchema.parse({ name: 'TrackIR5.exe', ...extra });
    expect(await check.standDown!(params({ stopOnStandDown: false }), rig.ctx)).toEqual(ok(null));
    // Not started by RigReady: left alone by default.
    expect(await check.standDown!(params({}), rig.ctx)).toEqual(ok(null));
    expect(await running('TrackIR5.exe')).toBe(true);
    session.add('TrackIR5.exe');
    expect(await check.standDown!(params({}), rig.ctx)).toEqual(ok('Closed TrackIR5.exe'));
    expect(await running('TrackIR5.exe')).toBe(false);
    // A graceful close, never a terminate: close() with a wait and no force.
    expect(rig.ports.processes.closed).toEqual([
      expect.objectContaining({ name: 'TrackIR5.exe', options: { waitMs: 10_000, force: false } }),
    ]);
    // Already closed: nothing to report.
    expect(await check.standDown!(params({ stopOnStandDown: true }), rig.ctx)).toEqual(ok(null));
  });

  it('stand down lists an app that will not close, and forces it only when the item allows', async () => {
    const { check } = setup();
    rig = await scenarioRig('flying-all-good', { files: [] });
    rig.ports.processes.stubborn.add('simapppro.exe');
    const params = ProcessParamsSchema.parse({ name: 'SimAppPro.exe', stopOnStandDown: true });
    expect(await check.standDown!(params, rig.ctx)).toMatchObject({
      ok: false,
      error: {
        code: 'process.stillRunning',
        message: 'SimAppPro.exe is still running: it did not close when asked.',
      },
    });
    expect(await running('SimAppPro.exe')).toBe(true);
    expect(await check.standDown!({ ...params, forceClose: true }, rig.ctx)).toEqual(
      ok('Closed SimAppPro.exe (it had to be forced)')
    );
    expect(await running('SimAppPro.exe')).toBe(false);
    rig.ports.processes.list = async () => err('process.list', 'nope');
    expect(await check.standDown!(params, rig.ctx)).toMatchObject({ ok: false });
  });
});

describe('process.launch', () => {
  it('starts the program with its argument array, confirms it is running and remembers it', async () => {
    const session = new SessionStarts();
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    const remediation = createLaunchRemediation(session, resolve, noWait);
    const params = LaunchParamsSchema.parse({ exe: TRACKIR, args: ['-minimized', 'a b && del *'] });
    expect(remediation.describe(params)).toBe('Start TrackIR5.exe');
    expect(await remediation.run(params, rig.ctx)).toEqual(ok('Started TrackIR5.exe'));
    // One literal argument each: nothing is ever joined into a command line.
    expect(rig.ports.processes.started).toEqual([
      { exe: TRACKIR, args: ['-minimized', 'a b && del *'] },
    ]);
    expect(session.has('trackir5.exe')).toBe(true);
  });

  it('resolves path variables in the program and working folder', async () => {
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    const remediation = createLaunchRemediation(new SessionStarts(), resolve, noWait);
    const params = LaunchParamsSchema.parse({
      exe: '{PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe',
      cwd: '{PROGRAM_FILES_X86}/TrackIR5',
    });
    expect(await remediation.run(params, rig.ctx)).toEqual(ok('Started TrackIR5.exe'));
    const programs = rig.ports.folders.programFilesX86();
    expect(rig.ports.processes.started).toEqual([
      {
        exe: path.join(programs, 'TrackIR5', 'TrackIR5.exe'),
        args: [],
        cwd: path.join(programs, 'TrackIR5'),
      },
    ]);
    expect(
      await remediation.run(LaunchParamsSchema.parse({ exe: 'relative.exe' }), rig.ctx)
    ).toMatchObject({ ok: false, error: { code: 'path.relative' } });
    expect(
      await remediation.run(LaunchParamsSchema.parse({ exe: 'C:\\x.exe', cwd: '{NOPE}' }), rig.ctx)
    ).toMatchObject({ ok: false, error: { code: 'path.variable' } });
  });

  it('fails honestly when the program does not show up before the timeout', async () => {
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    let sleeps = 0;
    const remediation = createLaunchRemediation(new SessionStarts(), resolve, async (ms) => {
      sleeps++;
      rig.clock.advance(ms);
    });
    // A launcher that starts a differently named process which never appears.
    const params = LaunchParamsSchema.parse({
      exe: 'C:\\Tools\\Launcher.exe',
      waitFor: 'Real.exe',
      timeoutMs: 1000,
    });
    expect(await remediation.run(params, rig.ctx)).toMatchObject({
      ok: false,
      error: {
        code: 'process.notStarted',
        message: 'Started Launcher.exe but Real.exe is not running after 1 s',
      },
    });
    expect(sleeps).toBe(4);
    // The process provider refusing to show the program: "it is not running after 10 s".
    rig.ports.processes.start = async () => ok({ pid: 1 });
    expect(
      await remediation.run(LaunchParamsSchema.parse({ exe: TRACKIR }), rig.ctx)
    ).toMatchObject({
      ok: false,
      error: { message: 'Started TrackIR5.exe but it is not running after 10 s' },
    });
  });

  it('says where it looked when the program is not there (real spawn)', async () => {
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    // The real start path: a detached spawn without a shell, which fails with ENOENT.
    const shell = new NodeShell();
    rig.ports.processes.start = (target) => shell.launch(target.exe, target.args);
    const missing = path.join(rig.home, 'Programs', 'SimAppPro', 'SimAppPro.exe');
    const result = await createLaunchRemediation(new SessionStarts(), resolve, noWait).run(
      LaunchParamsSchema.parse({ exe: missing }),
      rig.ctx
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'process.notFound', message: `SimAppPro.exe not found at ${missing}` },
    });
    rig.ports.processes.start = async () => err('shell.launch', 'Could not start.', 'EACCES');
    expect(
      await createLaunchRemediation(new SessionStarts(), resolve, noWait).run(
        LaunchParamsSchema.parse({ exe: missing }),
        rig.ctx
      )
    ).toMatchObject({ ok: false, error: { code: 'shell.launch' } });
  });

  it('as a launch action can wait for the program to finish, within its timeout', async () => {
    rig = await scenarioRig('flying-trackir-not-running', { files: [] });
    const exe = 'C:\\Tools\\Warmup.exe';
    let exitAfter = 3;
    const remediation = createLaunchRemediation(new SessionStarts(), resolve, async (ms) => {
      rig.clock.advance(ms);
      if (--exitAfter === 0) {
        rig.ports.state.processes = rig.ports.state.processes.filter(
          (p) => p.name !== 'Warmup.exe'
        );
      }
    });
    const params = LaunchParamsSchema.parse({ exe, waitForCompletion: true, timeoutSeconds: 5 });
    expect(await remediation.run(params, rig.ctx)).toEqual(ok('Ran Warmup.exe to completion'));
    exitAfter = 1000;
    expect(await remediation.run(params, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'process.timeout', message: 'Warmup.exe is still running after 5 s' },
    });
  });
});

describe('process capture', () => {
  it('lists sim helpers first and ticked, never Windows or RigReady itself, each with a launch fix', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    rig.ports.state.processes.push({
      pid: 99999,
      name: 'RigReady.exe',
      path: 'C:\\Users\\User\\AppData\\Local\\Programs\\RigReady\\RigReady.exe',
    });
    // An app installed under the user folder is stored with its path variable.
    rig.ports.state.processes.push({
      pid: 99998,
      name: 'VoiceAttack.exe',
      path: path.join(rig.ports.folders.programFiles(), 'VoiceAttack', 'VoiceAttack.exe'),
    });
    const processCapture = createProcessCapture(new GameRegistry());
    const result = await processCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    expect(result.value.find((c) => c.title === 'VoiceAttack')?.check.remediation).toEqual({
      type: 'process.launch',
      params: { exe: '{PROGRAM_FILES}/VoiceAttack/VoiceAttack.exe', args: [] },
    });
    const titles = result.value.map((c) => c.title);
    expect(titles.slice(0, 4)).toEqual(['SimAppPro', 'Stream Deck', 'TrackIR', 'VoiceAttack']);
    expect(result.value.filter((c) => c.selectedByDefault).map((c) => c.title)).toEqual([
      'SimAppPro',
      'Stream Deck',
      'TrackIR',
      'VoiceAttack',
    ]);
    const trackir = result.value.find((c) => c.title === 'TrackIR')!;
    expect(trackir.check).toMatchObject({
      type: 'process.running',
      params: { name: 'TrackIR5.exe' },
      remediation: { type: 'process.launch', params: { exe: TRACKIR, args: [] } },
    });
    expect(titles).not.toContain('RigReady');
    expect(result.value.some((c) => /^c:\\windows\\/i.test(c.description ?? ''))).toBe(false);
    expect(new Set(result.value.map((c) => c.key)).size).toBe(result.value.length);
    rig.ports.processes.list = async () => err('process.list', 'nope');
    expect(await processCapture.capture(rig.ctx)).toMatchObject({ ok: false });
  });
});
