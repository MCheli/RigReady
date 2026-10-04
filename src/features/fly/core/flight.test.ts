import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  planFixes,
  summarize,
  type ActionReport,
  type CheckResult,
} from '../../../core/checks/engine';
import { CheckRegistry } from '../../../core/checks/registry';
import { CHECK_GROUPS, type CheckGroup, type Profile } from '../../../core/profile/schema';
import { ok, type Result } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { LaunchResult } from '../contract';
import {
  afterMakeReady,
  blockers,
  FIX_PHASES,
  fixesLine,
  flightSteps,
  phaseState,
  runFlight,
  type FixState,
  type FlightCalls,
  type FlightStage,
} from './flight';

const result = (partial: Partial<CheckResult> & { itemId: string }): CheckResult => ({
  type: 'x',
  group: 'apps',
  title: partial.itemId,
  required: true,
  status: 'pass',
  summary: 'Fine',
  details: [],
  ...partial,
});

describe('the steps of Make ready and launch', () => {
  it('names the phases in the order Make ready really works in', () => {
    // A check type per group, each with a fix, listed in the setup back to front.
    const registry = new CheckRegistry();
    registry.registerRemediation({
      type: 'test.fix',
      label: 'Fix',
      order: 100,
      params: z.object({}),
      describe: () => 'Fix it',
      run: async () => ok('Fixed'),
    });
    for (const group of CHECK_GROUPS) {
      registry.registerCheck({
        type: `test.${group}`,
        group,
        label: group,
        params: z.object({}),
        run: async () => ({ pass: false, summary: 'Not met' }),
      });
    }
    const profile: Profile = {
      schemaVersion: 1,
      id: 'p',
      name: 'P',
      createdAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
      extensions: {},
      checks: [...CHECK_GROUPS].reverse().map((group) => ({
        id: group,
        type: `test.${group}`,
        title: group,
        required: true,
        params: {},
        remediation: { type: 'test.fix', params: {} },
      })),
    };
    const report = summarize(
      'p',
      profile.checks.map((item) =>
        result({
          itemId: item.id,
          group: item.id as CheckGroup,
          status: 'fail',
          fix: 'Fix it',
          fixKind: 'action',
        })
      )
    );
    const planned = planFixes(profile, report, registry).map((entry) => entry.item.id);
    expect(planned).toEqual(FIX_PHASES.map((phase) => phase.group));
    // Every group has a phase, and each phase a word of its own.
    expect([...FIX_PHASES.map((p) => p.group)].sort()).toEqual([...CHECK_GROUPS].sort());
    expect(FIX_PHASES.map((p) => p.label)).toEqual([
      'Monitors',
      'Audio',
      'Files',
      'Devices',
      'Apps',
      'Scripts',
    ]);
  });

  it('a phase is at work until its last fix has ended, and says how it ended', () => {
    const cases: [FixState[], string][] = [
      [[], 'none'],
      [['pending', 'pending'], 'pending'],
      [['running', 'pending'], 'running'],
      [['done', 'pending'], 'running'],
      [['done', 'done'], 'done'],
      [['done', 'failed'], 'failed'],
      [['skipped', 'skipped'], 'skipped'],
      [['done', 'skipped'], 'done'],
    ];
    for (const [states, expected] of cases)
      expect(phaseState(states), states.join()).toBe(expected);
  });

  it('shows every phase, the re-check and the launch, each in its state as the run goes on', () => {
    const fixes = (displays: FixState, files: FixState, apps: FixState[]) => [
      { group: 'displays' as const, state: displays },
      { group: 'files' as const, state: files },
      ...apps.map((state) => ({ group: 'apps' as const, state })),
    ];
    const states = (input: Parameters<typeof flightSteps>[0]): string =>
      flightSteps(input)
        .map((s) => `${s.id}:${s.state}`)
        .join(' ');

    // The monitors are being arranged: everything after waits.
    expect(
      states({
        fixes: fixes('running', 'pending', ['pending', 'pending']),
        stage: 'fixing',
        withLaunch: true,
      })
    ).toBe(
      'displays:running audio:none files:pending devices:none apps:pending other:none check:pending launch:pending'
    );
    // Fixes done, the checklist is being checked again.
    expect(
      states({
        fixes: fixes('done', 'done', ['done', 'done']),
        stage: 'checking',
        withLaunch: true,
      })
    ).toBe(
      'displays:done audio:none files:done devices:none apps:done other:none check:running launch:pending'
    );
    // Everything required is met: the game is started, then it is running.
    for (const [stage, launch] of [
      ['launching', 'running'],
      ['launched', 'done'],
      ['launchFailed', 'failed'],
    ] as const) {
      expect(
        states({ fixes: fixes('done', 'done', ['done', 'done']), stage, withLaunch: true })
      ).toBe(
        `displays:done audio:none files:done devices:none apps:done other:none check:done launch:${launch}`
      );
    }
    // One app did not come up: the launch is held, not failed, and not started.
    expect(
      states({
        fixes: fixes('done', 'done', ['done', 'failed']),
        stage: 'held',
        withLaunch: true,
      })
    ).toBe(
      'displays:done audio:none files:done devices:none apps:failed other:none check:done launch:held'
    );
    // Plain Make ready has no launch step.
    const plain = flightSteps({
      fixes: fixes('done', 'done', ['done']),
      stage: 'checked',
      withLaunch: false,
    });
    expect(plain.map((s) => s.id)).toEqual([...FIX_PHASES.map((p) => p.group), 'check']);
    expect(plain.at(-1)).toMatchObject({ id: 'check', state: 'done' });
    // A phase says how far it is.
    const counted = flightSteps({
      fixes: fixes('done', 'done', ['done', 'running', 'pending']),
      stage: 'fixing',
      withLaunch: true,
    }).find((s) => s.id === 'apps');
    expect(counted).toMatchObject({ state: 'running', total: 3, finished: 1 });
  });
});

describe('launching after Make ready', () => {
  it('goes ahead only when everything required is met', () => {
    const ready = summarize('p', [
      result({ itemId: 'a' }),
      result({ itemId: 'optional', required: false, status: 'warn', summary: 'Not connected' }),
      result({ itemId: 'off', disabled: true, required: false }),
    ]);
    expect(afterMakeReady({ report: ready })).toEqual({ go: true });
  });

  it('stops with what is still missing: a failure and a check that could not be done both count', () => {
    const report = summarize('p', [
      result({ itemId: 'a' }),
      result({ itemId: 'pedals', title: 'Pedals', status: 'fail', summary: 'Not connected' }),
      result({
        itemId: 'script',
        title: 'Script',
        status: 'error',
        summary: 'Timed out after 5 s',
      }),
      result({ itemId: 'deck', required: false, status: 'warn', summary: 'Not running' }),
    ]);
    expect(blockers(report).map((r) => r.itemId)).toEqual(['pedals', 'script']);
    expect(afterMakeReady({ report })).toEqual({
      go: false,
      blockers: [
        { itemId: 'pedals', title: 'Pedals', summary: 'Not connected' },
        { itemId: 'script', title: 'Script', summary: 'Timed out after 5 s' },
      ],
    });
  });

  it('never goes on a report that says not ready, whatever its rows say', () => {
    const report = { ...summarize('p', [result({ itemId: 'a' })]), ready: false };
    expect(afterMakeReady({ report })).toEqual({ go: false, blockers: [] });
  });

  it('sums the fixes up in one line', () => {
    expect(fixesLine([])).toBe('Nothing RigReady can fix');
    expect(fixesLine([{ ok: true }])).toBe('1 of 1 fix worked');
    expect(fixesLine([{ ok: true }, { ok: false }, { ok: false, skipped: true }])).toBe(
      '1 of 3 fixes worked · 1 failed'
    );
  });
});

describe('Make ready and launch, on the wired app', () => {
  let app: WiredApp;
  afterEach(async () => {
    for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
    await app?.cleanup();
  });

  /** The two calls as the Play screen makes them, through IPC validation, with a note of each. */
  const calls = (profileId: string, made: string[]): FlightCalls => {
    const call = async <T>(channel: string, input: unknown): Promise<Result<T>> => {
      made.push(channel);
      return (await app.wiring.handlers.get(channel)!(input)) as Result<T>;
    };
    return {
      makeReady: () => call<ActionReport>('fly:makeReady', { profileId, approved: [] }),
      launch: () => call<LaunchResult>('fly:launch', { profileId }),
    };
  };
  const startedGame = (): boolean =>
    app.ports.processes.started.some((target) => /DCS\.exe$/i.test(target.exe));
  const stages = (): { seen: FlightStage[]; note: (stage: FlightStage) => void } => {
    const seen: FlightStage[] = [];
    return { seen, note: (stage) => seen.push(stage) };
  };

  it('fixes four things in order, checks again, and starts the game only then', async () => {
    app = await wiredApp('fly-make-ready-all');
    const made: string[] = [];
    const { seen, note } = stages();
    const outcome = await runFlight(calls('fly-hornet-full', made), note);
    expect(outcome.stage).toBe('launched');
    expect(made).toEqual(['fly:makeReady', 'fly:launch']);
    expect(seen).toEqual(['fixing', 'launching', 'launched']);
    if (outcome.stage !== 'launched') return;
    expect(outcome.ready.steps.map((s) => [s.title, s.ok])).toEqual([
      ['Monitor layout', true],
      ['DCS options', true],
      ['SimAppPro', true],
      ['TrackIR', true],
    ]);
    expect(outcome.ready.report.ready).toBe(true);
    expect(outcome.launch).toMatchObject({ outcome: 'launched', message: 'Launched DCS.exe' });
    expect(startedGame()).toBe(true);
  });

  it('waits for "Keep this layout?" before anything else happens', async () => {
    app = await wiredApp('fly-make-ready-all');
    app.layoutAnswer = 'wait';
    const made: string[] = [];
    const { seen, note } = stages();
    let finished = false;
    const flying = runFlight(calls('fly-hornet-full', made), note).finally(() => (finished = true));
    await vi.waitFor(() =>
      expect(app.events.some((e) => e.channel === 'displays:event:applied')).toBe(true)
    );
    // The question is open: no later fix has run, nothing was checked again, nothing launched.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(finished).toBe(false);
    expect(made).toEqual(['fly:makeReady']);
    expect(seen).toEqual(['fixing']);
    expect(app.ports.processes.started).toEqual([]);
    await app.invoke('displays:keep');
    const outcome = await flying;
    expect(outcome.stage).toBe('launched');
    expect(startedGame()).toBe(true);
  });

  it('stops when the layout is not kept: says what is still missing and does not launch', async () => {
    app = await wiredApp('fly-make-ready-all');
    app.layoutAnswer = 'revert';
    const made: string[] = [];
    const { seen, note } = stages();
    const outcome = await runFlight(calls('fly-hornet-full', made), note);
    expect(outcome.stage).toBe('held');
    expect(made).toEqual(['fly:makeReady']);
    expect(seen).toEqual(['fixing', 'held']);
    if (outcome.stage !== 'held') return;
    expect(outcome.blockers.map((b) => b.title)).toEqual(['Monitor layout']);
    // The other fixes still ran and worked.
    expect(outcome.ready.steps.filter((s) => s.ok).map((s) => s.title)).toEqual([
      'DCS options',
      'SimAppPro',
      'TrackIR',
    ]);
    expect(startedGame()).toBe(false);
  });

  it('stops for something only the user can do, after fixing what it could', async () => {
    app = await wiredApp('flying-pedals-unplugged');
    await mutate(app, [{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
    const made: string[] = [];
    const outcome = await runFlight(calls('dcs-f-a-18c', made));
    expect(outcome.stage).toBe('held');
    if (outcome.stage !== 'held') return;
    expect(outcome.ready.steps).toMatchObject([{ title: 'TrackIR5', ok: true }]);
    expect(outcome.blockers).toEqual([
      { itemId: 'c3', title: 'T-Pendular-Rudder', summary: 'Not connected' },
    ]);
    expect(made).toEqual(['fly:makeReady']);
    expect(startedGame()).toBe(false);
  });

  it('a game that does not start is a failed launch, not a launched one', async () => {
    app = await wiredApp('flying-trackir-not-running');
    await mutate(app, [{ op: 'failProcessStart', name: 'DCS.exe' }]);
    const { seen, note } = stages();
    const outcome = await runFlight(calls('dcs-f-a-18c', []), note);
    expect(outcome.stage).toBe('launchFailed');
    expect(seen).toEqual(['fixing', 'launching', 'launchFailed']);
    if (outcome.stage !== 'launchFailed') return;
    expect(outcome.launch.outcome).toBe('failed');
    expect(outcome.launch.message).toMatch(/Could not start .*DCS\.exe/);
  });

  it('a setup that cannot be opened ends the run before anything is done', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const made: string[] = [];
    const outcome = await runFlight(calls('no-such-setup', made));
    expect(outcome.stage).toBe('failed');
    expect(made).toEqual(['fly:makeReady']);
    expect(app.ports.processes.started).toEqual([]);
  });

  it('a launch that cannot be asked for at all says so', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { seen, note } = stages();
    const outcome = await runFlight(
      {
        makeReady: () =>
          app.wiring.handlers.get('fly:makeReady')!({ profileId: 'dcs-f-a-18c' }) as Promise<
            Result<ActionReport>
          >,
        launch: async () => ({
          ok: false,
          error: { code: 'ipc.send', message: 'The request could not be sent.' },
        }),
      },
      note
    );
    expect(outcome).toMatchObject({ stage: 'launchError', error: { code: 'ipc.send' } });
    expect(seen).toEqual(['fixing', 'launching', 'launchFailed']);
  });
});
