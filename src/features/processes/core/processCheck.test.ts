import { afterEach, describe, expect, it } from 'vitest';
import { err, ok } from '../../../core/result';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  createLaunchRemediation,
  LaunchParamsSchema,
  processCapture,
  ProcessParamsSchema,
  processRunningCheck,
} from './processCheck';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const TRACKIR = 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe';

describe('process.running', () => {
  it('passes when the app runs (case-insensitive) and fails when it does not', async () => {
    rig = await scenarioRig('flying-all-good');
    expect(
      await processRunningCheck.run(ProcessParamsSchema.parse({ name: 'trackir5.EXE' }), rig.ctx)
    ).toEqual({ pass: true, summary: 'Running' });
    await rig.cleanup();
    rig = await scenarioRig('flying-trackir-not-running');
    expect(
      await processRunningCheck.run(ProcessParamsSchema.parse({ name: 'TrackIR5.exe' }), rig.ctx)
    ).toEqual({ pass: false, summary: 'Not running' });
    rig.ports.processes.list = async () => err('process.list', 'Could not list running programs.');
    expect(
      await processRunningCheck.run(ProcessParamsSchema.parse({ name: 'TrackIR5.exe' }), rig.ctx)
    ).toEqual({ pass: false, summary: 'Could not list running programs.' });
  });

  it('stand down closes the app only when asked to', async () => {
    rig = await scenarioRig('flying-all-good');
    const running = async (): Promise<boolean> => {
      const list = await rig.ports.processes.list();
      return list.ok && list.value.some((p) => p.name === 'TrackIR5.exe');
    };
    expect(
      await processRunningCheck.standDown!(
        { name: 'TrackIR5.exe', stopOnStandDown: false },
        rig.ctx
      )
    ).toEqual(ok(null));
    expect(await running()).toBe(true);
    expect(
      await processRunningCheck.standDown!({ name: 'TrackIR5.exe', stopOnStandDown: true }, rig.ctx)
    ).toEqual(ok('Closed TrackIR5.exe'));
    expect(await running()).toBe(false);
    // Already closed: nothing to report.
    expect(
      await processRunningCheck.standDown!({ name: 'TrackIR5.exe', stopOnStandDown: true }, rig.ctx)
    ).toEqual(ok(null));
  });

  it('stand down reports a process that cannot be stopped', async () => {
    rig = await scenarioRig('flying-all-good');
    rig.ports.processes.stop = async () => err('process.stop', 'Windows refused.');
    expect(
      await processRunningCheck.standDown!({ name: 'TrackIR5.exe', stopOnStandDown: true }, rig.ctx)
    ).toMatchObject({ ok: false });
    rig.ports.processes.list = async () => err('process.list', 'nope');
    expect(
      await processRunningCheck.standDown!({ name: 'TrackIR5.exe', stopOnStandDown: true }, rig.ctx)
    ).toMatchObject({ ok: false });
  });
});

describe('process.launch', () => {
  it('starts the program with its argument array and confirms it is running', async () => {
    rig = await scenarioRig('flying-trackir-not-running');
    const remediation = createLaunchRemediation(async () => {});
    const params = LaunchParamsSchema.parse({ exe: TRACKIR, args: ['-minimized', 'a b'] });
    expect(remediation.describe(params)).toBe('Start TrackIR5.exe');
    expect(await remediation.run(params, rig.ctx)).toEqual(ok('Started TrackIR5.exe'));
    expect(rig.ports.processes.started).toEqual([{ exe: TRACKIR, args: ['-minimized', 'a b'] }]);
    expect(
      (await processRunningCheck.run({ name: 'TrackIR5.exe', stopOnStandDown: false }, rig.ctx))
        .pass
    ).toBe(true);
  });

  it('fails honestly when the program does not show up before the timeout', async () => {
    rig = await scenarioRig('flying-trackir-not-running');
    let sleeps = 0;
    const remediation = createLaunchRemediation(async (ms) => {
      sleeps++;
      rig.clock.advance(ms);
    });
    // A launcher that starts a differently named process which never appears.
    const params = LaunchParamsSchema.parse({
      exe: 'C:\\Tools\\Launcher.exe',
      waitFor: 'Real.exe',
      timeoutMs: 1000,
      cwd: 'C:\\Tools',
    });
    expect(await remediation.run(params, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'process.notStarted' },
    });
    expect(sleeps).toBe(4);
  });

  it('passes a start failure through', async () => {
    rig = await scenarioRig('flying-trackir-not-running');
    const params = LaunchParamsSchema.parse({ exe: 'not-absolute.exe' });
    expect(await createLaunchRemediation().run(params, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'shell.launch' },
    });
  });
});

describe('process capture', () => {
  it('proposes programs that could be started again, none pre-selected, each with a launch fix', async () => {
    rig = await scenarioRig('flying-fresh');
    const result = await processCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    const trackir = result.value.find((c) => c.title === 'TrackIR5')!;
    expect(trackir.check).toMatchObject({
      type: 'process.running',
      params: { name: 'TrackIR5.exe' },
      remediation: { type: 'process.launch', params: { exe: TRACKIR, args: [] } },
    });
    expect(result.value.every((c) => !c.selectedByDefault)).toBe(true);
    expect(result.value.some((c) => /^c:\\windows\\/i.test(c.description ?? ''))).toBe(false);
    expect(new Set(result.value.map((c) => c.key)).size).toBe(result.value.length);
    rig.ports.processes.list = async () => err('process.list', 'nope');
    expect(await processCapture.capture(rig.ctx)).toMatchObject({ ok: false });
  });
});
