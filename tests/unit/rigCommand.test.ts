/**
 * WOW-WIN-001: `RigReady.exe --fly "<setup>"`, `--make-ready` and `--setup`, as the shell
 * runs them (src/main/rigCommand.ts), on every feature wired onto the fake machine.
 *
 * What is proven here: the command goes through the same IPC handlers the Fly screen and the
 * tray use, in order; the game is started only when every required item is met; a monitor
 * layout still waits for "Keep this layout?"; and whatever stops it is said in words.
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCommandLine } from '../../src/core/commandLine';
import { CommandRunner } from '../../src/main/rigCommand';
import type { CommandRun } from '../../src/shared/appContract';
import { CommandRunSchema } from '../../src/shared/appContract';
import { mutate, wiredApp, type WiredApp } from '../helpers';

interface Harness {
  app: WiredApp;
  runner: CommandRunner;
  /** Every state the window was told, in order. */
  published: CommandRun[];
  /** Every IPC channel the command called, in order. */
  called: string[];
  shown: number;
  flyChanged: number;
  working: boolean[];
  /** The programs the fake machine was asked to start, by image name. */
  started(): string[];
}

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
  }
  apps = [];
});

async function harness(scenario: string, busy = false): Promise<Harness> {
  const app = await wiredApp(scenario);
  apps.push(app);
  const h: Harness = {
    app,
    published: [],
    called: [],
    shown: 0,
    flyChanged: 0,
    working: [],
    started: () => app.ports.processes.started.map((t) => path.win32.basename(t.exe)),
    runner: undefined as never,
  };
  h.runner = new CommandRunner({
    call: (channel, input) => {
      h.called.push(channel);
      return app.wiring.handlers.get(channel)!(input);
    },
    publish: (run) => h.published.push(run),
    showWindow: () => h.shown++,
    flyChanged: () => h.flyChanged++,
    busy: () => busy,
    working: (on) => h.working.push(on),
  });
  // The shell hands the runner every event the features send; here they arrive in app.events.
  const push = app.events.push.bind(app.events);
  app.events.push = (...events) => {
    for (const event of events) h.runner.onEvent(event.channel, event.payload);
    return push(...events);
  };
  return h;
}

const fly = (setup: string) => ({ action: 'fly' as const, setup });

describe('WOW-WIN-001 --fly: make ready, then launch', () => {
  it('with everything ready it launches at once, through the handlers the tray uses', async () => {
    const h = await harness('flying-all-good');
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({
      action: 'fly',
      asked: 'dcs-f-a-18c',
      setup: { id: 'dcs-f-a-18c', name: 'DCS F/A-18C' },
      phase: 'finished',
      outcome: 'launched',
      tone: 'ok',
      headline: 'Launched DCS.exe',
      reasons: [],
      canCancel: false,
    });
    // Nothing needed fixing, so Make ready was not run: check, then launch.
    expect(h.called).toEqual(['fly:state', 'fly:check', 'fly:state', 'fly:launch']);
    expect(h.started()).toEqual(['DCS.exe']);
    expect(h.shown).toBeGreaterThan(0);
    // The Fly screen is told: once when the setup is chosen, once when it is over.
    expect(h.flyChanged).toBe(2);
    expect(h.working).toEqual([true, false]);
    expect(h.published.map((p) => p.phase)).toContain('launching');
    // Everything the window is told fits the contract it is sent under.
    for (const state of h.published) expect(CommandRunSchema.safeParse(state).success).toBe(true);
    expect(h.runner.state()).toEqual(run);
  });

  it('is found by name too, and becomes the setup in use', async () => {
    const h = await harness('fly-two-setups');
    expect(await h.app.wiring.context.profiles.lastProfileId()).toBe('fly-dcs-uh-1h');
    const run = await h.runner.run(fly('dcs f/a-18c'));
    expect(run).toMatchObject({ outcome: 'launched', setup: { id: 'dcs-f-a-18c' } });
    expect(await h.app.wiring.context.profiles.lastProfileId()).toBe('dcs-f-a-18c');
  });

  it('runs the fixes first, in order, and launches only after the rig is ready', async () => {
    const h = await harness('flying-trackir-not-running');
    const run = await h.runner.run(fly('DCS F/A-18C'));
    expect(run).toMatchObject({ outcome: 'launched', tone: 'ok', headline: 'Launched DCS.exe' });
    expect(h.called).toEqual([
      'fly:state',
      'fly:check',
      'fly:state',
      'fly:makeReady',
      'fly:launch',
    ]);
    // TrackIR was started before the game.
    expect(h.started()).toEqual(['TrackIR5.exe', 'DCS.exe']);
    expect(h.published.map((p) => p.phase)).toEqual(
      expect.arrayContaining(['checking', 'makingReady', 'launching', 'finished'])
    );
    // The window saw the fix start and end while it ran, then the game.
    const during = h.published.filter((p) => p.phase === 'makingReady').flatMap((p) => p.steps);
    expect(during).toContainEqual({ id: 'c13', title: 'TrackIR5', state: 'running' });
    expect(run!.steps).toContainEqual({
      id: 'c13',
      title: 'TrackIR5',
      state: 'done',
      message: 'Started TrackIR5.exe',
    });
    expect(run!.steps.at(-1)).toMatchObject({ id: 'launch:game', state: 'done' });
  });

  it('never launches past a required item that is not met: it stops, in front, and says why', async () => {
    const h = await harness('flying-pedals-unplugged');
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({
      phase: 'finished',
      outcome: 'stopped',
      tone: 'bad',
      headline: 'DCS F/A-18C was not launched: 1 required item is not met',
    });
    expect(run!.reasons).toHaveLength(1);
    expect(run!.reasons[0]).toMatch(/^T-Pendular-Rudder: /);
    expect(h.called).not.toContain('fly:launch');
    expect(h.started()).toEqual([]);
    // Brought forward when it began and again when it stopped.
    expect(h.shown).toBe(2);
  });

  it('stops when the only fix for a required item does not work', async () => {
    const h = await harness('flying-trackir-not-running');
    await mutate(h.app, [{ op: 'failProcessStart', name: 'TrackIR5.exe', mode: 'error' }]);
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({ outcome: 'stopped', tone: 'bad' });
    // The item, what is wrong with it, and what the fix said.
    expect(run!.reasons).toHaveLength(1);
    expect(run!.reasons[0]).toMatch(/^TrackIR5: .*Could not start/);
    expect(h.started()).toEqual([]);
  });

  it('a monitor layout still asks "Keep this layout?": kept, it launches', async () => {
    const h = await harness('flying-mfd-rotated');
    h.app.layoutAnswer = 'keep';
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(h.app.events.map((e) => e.channel)).toContain('displays:event:applied');
    expect(run).toMatchObject({ outcome: 'launched' });
    expect(h.started()).toEqual(['DCS.exe']);
  });

  it('a monitor layout that is not kept goes back, and the game is not launched', async () => {
    const h = await harness('flying-mfd-rotated');
    h.app.layoutAnswer = 'revert';
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({ outcome: 'stopped', tone: 'bad' });
    expect(run!.reasons.join(' ')).toMatch(/Monitor layout: /);
    expect(h.started()).toEqual([]);
  });

  it('"Do not launch" while it waits for the layout answer: made ready, not launched', async () => {
    const h = await harness('flying-mfd-rotated');
    h.app.layoutAnswer = 'wait';
    const pending = h.runner.run(fly('dcs-f-a-18c'));
    await expect
      .poll(() => h.app.events.some((e) => e.channel === 'displays:event:applied'))
      .toBe(true);
    expect(h.runner.running()).toBe(true);
    expect(h.runner.state()).toMatchObject({ phase: 'makingReady', canCancel: true });

    // A second command while this one runs changes nothing: the first goes on.
    const second = await h.runner.run({ action: 'makeReady', setup: 'dcs-f-a-18c' });
    expect(second).toMatchObject({ id: 1, phase: 'makingReady' });

    expect(h.runner.cancel()).toBe(true);
    expect(h.runner.state()).toMatchObject({
      canCancel: false,
      headline: 'Making DCS F/A-18C ready. It will not be launched',
    });
    // Too late to cancel twice.
    expect(h.runner.cancel()).toBe(false);
    await h.app.invoke('displays:keep');
    const run = await pending;
    expect(run).toMatchObject({
      outcome: 'cancelled',
      tone: 'idle',
      headline: 'DCS F/A-18C is ready. Not launched, as you asked',
    });
    expect(h.called).not.toContain('fly:launch');
    expect(h.started()).toEqual([]);
    // Nothing left to cancel, and the next command is a new one.
    expect(h.runner.cancel()).toBe(false);
    expect(await h.runner.run({ action: 'select', setup: 'dcs-f-a-18c' })).toMatchObject({ id: 2 });
  });

  it('launches with optional items not met, and names them', async () => {
    const h = await harness('flying-optional-missing');
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({
      outcome: 'launched',
      tone: 'warn',
      headline: 'Launched DCS.exe',
      reasons: ['1 optional item is not met: Stream Deck XL'],
    });
  });

  it('a step before launch that must not fail stops it, with what the step said', async () => {
    const h = await harness('fly-actions');
    const run = await h.runner.run(fly('fly-actions'));
    expect(run).toMatchObject({ outcome: 'stopped', tone: 'bad' });
    expect(run!.headline).toBe('DCS with launch steps was not launched');
    expect(run!.reasons[0]).toContain('"Check TrackIR answers" failed');
    expect(run!.reasons[1]).toBe(
      'Press Launch on the Fly screen to decide whether to launch anyway.'
    );
    expect(h.started()).not.toContain('DCS.exe');
  });

  it('a setup that launches nothing is made ready and says there is nothing to launch', async () => {
    const h = await harness('flying-all-good');
    const { profiles } = h.app.wiring.context;
    const loaded = await profiles.get('dcs-f-a-18c');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const { launch: _launch, ...rest } = loaded.value;
    await profiles.save(rest);
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({
      outcome: 'stopped',
      tone: 'warn',
      headline: 'DCS F/A-18C is ready, but it has nothing to launch',
    });
    expect(h.called).not.toContain('fly:launch');
  });

  it('is refused while the tray or the window is already working, and only brings the window forward', async () => {
    const h = await harness('flying-all-good', true);
    expect(await h.runner.run(fly('dcs-f-a-18c'))).toBeNull();
    expect(h.shown).toBe(1);
    expect(h.called).toEqual([]);
    expect(h.published).toEqual([]);
  });
});

describe('WOW-WIN-001 --make-ready and --setup', () => {
  it('--make-ready runs the fixes and stops before launching', async () => {
    const h = await harness('flying-trackir-not-running');
    const run = await h.runner.run({ action: 'makeReady', setup: 'dcs-f-a-18c' });
    expect(run).toMatchObject({
      action: 'makeReady',
      outcome: 'ready',
      tone: 'ok',
      headline: 'DCS F/A-18C is ready',
    });
    expect(h.started()).toEqual(['TrackIR5.exe']);
    expect(h.called).not.toContain('fly:launch');
    // It never offers "Do not launch": there is no launch to keep from happening.
    expect(h.published.every((p) => !p.canCancel)).toBe(true);
  });

  it('--make-ready says what is still not met', async () => {
    const h = await harness('flying-pedals-unplugged');
    const run = await h.runner.run({ action: 'makeReady', setup: 'dcs-f-a-18c' });
    expect(run).toMatchObject({
      outcome: 'stopped',
      tone: 'bad',
      headline: 'DCS F/A-18C is not ready: 1 required item is not met',
    });
  });

  it('--setup only makes it the setup in use', async () => {
    const h = await harness('fly-two-setups');
    const run = await h.runner.run({ action: 'select', setup: 'DCS F/A-18C' });
    expect(run).toMatchObject({
      action: 'select',
      outcome: 'selected',
      tone: 'idle',
      headline: 'Showing DCS F/A-18C',
    });
    expect(h.called).toEqual(['fly:state', 'fly:check', 'fly:state']);
    expect(h.started()).toEqual([]);
    expect(await h.app.wiring.context.profiles.lastProfileId()).toBe('dcs-f-a-18c');
  });
});

describe('WOW-WIN-001 a command that cannot be followed', () => {
  it('an unknown setup opens the window and says so, with the setups there are', async () => {
    const h = await harness('fly-two-setups');
    const run = await h.runner.run(fly('F-16C Viper'));
    expect(run).toMatchObject({
      outcome: 'stopped',
      tone: 'warn',
      asked: 'F-16C Viper',
      headline: 'There is no setup "F-16C Viper"',
      reasons: ['Setups on this PC: DCS F/A-18C, DCS UH-1H.'],
    });
    expect(run!.setup).toBeUndefined();
    expect(h.called).toEqual(['fly:state']);
    expect(h.shown).toBe(2);
    // The setup in use is left as it was.
    expect(await h.app.wiring.context.profiles.lastProfileId()).toBe('fly-dcs-uh-1h');
  });

  it('on a PC without setups it says there are none yet', async () => {
    const h = await harness('flying-fresh');
    const run = await h.runner.run(fly('dcs-f-a-18c'));
    expect(run).toMatchObject({
      outcome: 'stopped',
      reasons: ['No setup has been created yet. Create one from this rig first.'],
    });
  });

  it('arguments that ask for nothing do nothing; arguments that are wrong say how to write them', async () => {
    const h = await harness('flying-all-good');
    expect(await h.runner.handle(parseCommandLine(['RigReady.exe', '--hidden']))).toBeNull();
    expect(h.published).toEqual([]);
    expect(h.shown).toBe(0);

    const run = await h.runner.handle(parseCommandLine(['RigReady.exe', '--fly']));
    expect(run).toMatchObject({
      outcome: 'stopped',
      tone: 'warn',
      headline: '--fly needs a setup: RigReady.exe --fly "<setup>"',
    });
    expect(h.shown).toBeGreaterThan(0);
    expect(h.called).toEqual([]);

    // And a command that can be followed is run.
    const flown = await h.runner.handle(parseCommandLine(['RigReady.exe', '--fly=dcs-f-a-18c']));
    expect(flown).toMatchObject({ id: 2, outcome: 'launched' });
  });

  it('progress of somebody else’s Make ready is not this command’s', async () => {
    const h = await harness('flying-all-good');
    await h.runner.run({ action: 'select', setup: 'dcs-f-a-18c' });
    const before = h.published.length;
    // The run is over, and the event carries the window's own run id.
    h.runner.onEvent('fly:event:progress', {
      runId: 'ready-1',
      itemId: 'c13',
      title: 'TrackIR5',
      state: 'running',
    });
    h.runner.onEvent('fly:event:progress', 'not an event');
    expect(h.published).toHaveLength(before);
  });
});
