import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import { standDownOnClose, withStandDownOnClose } from '../../../core/profile/standDownOnClose';
import { err, ok } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { SessionRecord, SessionState } from '../contract';
import { Fly } from './fly';
import { problemText } from './sessionText';
import {
  AWAY_MS,
  HISTORY_LISTED,
  LOOK_BACK_MS,
  MAX_SESSIONS,
  PRESENCE_MS,
  QUICK_EXIT_MS,
  SessionLog,
  sessionTotals,
  SessionTracker,
  type TrackerDeps,
  type TrackerOptions,
} from './sessions';

let app: WiredApp;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
});

const P = 'dcs-f-a-18c';
const MINUTE = 60_000;

const sessionsDir = (): string => path.join(app.ports.folders.dataRoot(), 'fly');
const notified = (): { title: string; body: string }[] => app.ports.notifications.sent;
const iso = (): string => app.clock.now().toISOString();

/** Fly and the tracker as the feature wires them. The test looks at the process list itself. */
function make(options: TrackerOptions = {}): {
  fly: Fly;
  tracker: SessionTracker;
  log: SessionLog;
  states: SessionState[];
} {
  const states: SessionState[] = [];
  const log = new SessionLog(app.ports.files, sessionsDir());
  const tracker: SessionTracker = new SessionTracker(
    app.wiring.context,
    log,
    {
      emit: (state) => states.push(state),
      standDown: async (profileId) => {
        const down = await fly.standDown(profileId, { closeGame: false });
        if (!down.ok) return down;
        const failed = down.value.steps.filter((s) => !s.ok && !s.skipped);
        return ok({
          headline: down.value.headline,
          failed: failed.length,
          problems: failed.map(problemText),
        });
      },
      standDownOnClose: async (profileId) => {
        const found = await fly.profile(profileId);
        return found.ok ? standDownOnClose(found.value.profile) : { enabled: false, seconds: 60 };
      },
      standDownNeedsYou: (profileId) => fly.standDownNeedsYou(profileId),
      showWindow: async () => {
        await app.ports.window.showOn([{ x: 0, y: 0, width: 1920, height: 1080 }]);
      },
    },
    { sleep: () => new Promise(() => {}), ...options }
  );
  const fly: Fly = new Fly(
    app.wiring.context,
    { result: () => {}, progress: () => {}, launchProgress: () => {} },
    {
      sleep: async (ms) => app.clock.advance(ms),
      timer: () => new Promise(() => {}),
      sessions: tracker,
      sessionLog: log,
    }
  );
  return { fly, tracker, log, states };
}

async function saveProfile(
  partial: Partial<Profile> & { id: string; name: string }
): Promise<Profile> {
  const saved = await app.wiring.context.profiles.save({
    schemaVersion: 1,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    checks: [],
    extensions: {},
    ...partial,
  });
  if (!saved.ok) throw new Error(saved.error.message);
  return saved.value;
}

const closeGame = (): Promise<void> => mutate(app, [{ op: 'stopProcess', name: 'DCS.exe' }]);
const startGame = (): Promise<void> =>
  mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\Games\\DCS\\bin\\DCS.exe' }]);

/** What the setup says about standing down by itself, written into the setup's own file. */
async function setupSays(enabled: boolean, seconds: number): Promise<void> {
  const found = await app.wiring.context.profiles.get(P);
  if (!found.ok) throw new Error(found.error.message);
  const saved = await app.wiring.context.profiles.save(
    withStandDownOnClose(found.value, { enabled, seconds })
  );
  if (!saved.ok) throw new Error(saved.error.message);
}

/** The time on the clock in `ms` from now, as the session says it. */
const inMs = (ms: number): string => new Date(app.clock.now().getTime() + ms).toISOString();

describe('a session, from Launch to the game closing', () => {
  it('starts when the game runs, lasts while it runs, and ends when its program is gone: recorded with its length', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, log, states } = make();
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    await fly.check(P);
    const launched = await fly.launch(P);
    expect(launched.ok && launched.value.outcome).toBe('launched');
    const started = iso();
    expect(await tracker.current()).toEqual({
      phase: 'running',
      profileId: P,
      profileName: 'DCS F/A-18C',
      gameName: 'DCS World',
      startedAt: started,
    });
    expect(states).toEqual([await tracker.current()]);

    // An hour in: still flying. Nothing is on the record yet.
    app.clock.advance(60 * MINUTE);
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('running');
    expect((await log.history()).sessions).toEqual([]);

    // The game is closed.
    app.clock.advance(42 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect(await tracker.current()).toEqual({
      phase: 'ended',
      profileId: P,
      profileName: 'DCS F/A-18C',
      gameName: 'DCS World',
      startedAt: started,
      endedAt: iso(),
      durationSeconds: 102 * 60,
      // This setup says nothing about standing down by itself: on, in one minute.
      standDownAt: inMs(MINUTE),
      standDownSeconds: 60,
    });
    expect(states.at(-1)?.phase).toBe('ended');
    const history = await log.history();
    expect(history.sessions).toEqual([
      {
        id: `${started}-${P}`,
        profileId: P,
        profileName: 'DCS F/A-18C',
        gameName: 'DCS World',
        startedAt: started,
        durationSeconds: 6120,
        readySeconds: 0,
        fixed: [],
      },
    ]);
    expect(history.line).toBe('1 session, 1 h 42 min');
    expect(history.totals).toEqual({
      sessions: 1,
      seconds: 6120,
      fixes: [],
      readySeconds: 0,
      notReady: 0,
    });
    // The setup now knows when it was last flown.
    const state = await fly.state();
    expect(state.ok && state.value.profiles[0]).toMatchObject({
      kind: 'flight',
      lastSession: { startedAt: started, durationSeconds: 6120 },
    });
    // Another look a moment later adds nothing to the record.
    await tracker.poll();
    expect((await log.history()).sessions).toHaveLength(1);
  });

  it('looks at the process list by itself, every few seconds, until the game is gone or RigReady quits', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const waits: { ms: number; wake: () => void }[] = [];
    const { fly, tracker, states } = make({
      sleep: (ms) => new Promise<void>((wake) => waits.push({ ms, wake })),
    });
    await fly.launch(P);
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    expect(waits[0]!.ms).toBe(2000);
    // Still running: it waits again.
    waits[0]!.wake();
    await vi.waitFor(() => expect(waits).toHaveLength(2));
    expect((await tracker.current()).phase).toBe('running');
    await closeGame();
    waits[1]!.wake();
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('ended'));
    // The session is over. One wait is left: RigReady looks for the game to come back.
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits).toHaveLength(3);

    // A second session, and RigReady quits in the middle of it: the loops end with it.
    await fly.launch(P);
    await vi.waitFor(() => expect(waits).toHaveLength(4));
    tracker.stop();
    await closeGame();
    waits[2]!.wake();
    waits[3]!.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits).toHaveLength(4);
    expect((await tracker.current()).phase).toBe('running');
  });

  it('a process list that cannot be read is not the game closing', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, log } = make();
    await fly.launch(P);
    const list = app.ports.processes.list.bind(app.ports.processes);
    app.ports.processes.list = async () => err('process.list', 'Could not list running programs.');
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('running');
    app.ports.processes.list = list;
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('running');
    expect((await log.history()).sessions).toEqual([]);
  });

  it('Launch pressed again while the game runs is still the same session', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, log } = make();
    await fly.launch(P);
    const started = iso();
    app.clock.advance(10 * MINUTE);
    await fly.launch(P);
    expect((await tracker.current()).startedAt).toBe(started);
    await mutate(app, [{ op: 'stopProcess', name: 'DCS.exe' }]);
    await tracker.poll();
    expect((await log.history()).sessions).toMatchObject([{ startedAt: started }]);
  });

  it('another setup launched while a game is still watched ends that session where the new one starts', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await saveProfile({
      id: 'other',
      name: 'Other sim',
      launch: { exe: 'C:\\Games\\Other\\Other.exe', args: [] },
    });
    const { fly, tracker, log } = make();
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await fly.launch('other');
    expect(await tracker.current()).toMatchObject({ phase: 'running', profileName: 'Other sim' });
    expect((await log.history()).sessions).toMatchObject([
      { profileId: P, durationSeconds: 30 * 60 },
    ]);
  });
});

describe('how the rig got ready goes on the record', () => {
  it('the time from opening to ready, what was fixed, and what was wrong first', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly, tracker, log } = make();
    const first = await fly.check(P);
    expect(first.ok && first.value.ready).toBe(false);
    app.clock.advance(8000);
    const made = await fly.makeReady(P);
    expect(made.ok && made.value.report.ready).toBe(true);
    app.clock.advance(3000);
    await fly.launch(P);
    app.clock.advance(20 * MINUTE);
    await closeGame();
    await tracker.poll();
    const [session] = (await log.history()).sessions;
    expect(session).toMatchObject({
      readySeconds: 8,
      fixed: [{ title: 'TrackIR5', group: 'apps', message: 'Started TrackIR5.exe' }],
      failedFirst: { title: 'TrackIR5', summary: 'Not running' },
      durationSeconds: 1200,
    });
    expect(session!.notReady).toBeUndefined();
    expect((await log.history()).line).toBe('1 session, 20 min; TrackIR5 needed starting once');
  });

  it('a fix from its own button counts, once', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly, tracker, log } = make();
    await fly.check(P);
    const fixed = await fly.fix(P, 'c13', false);
    expect(fixed.ok && fixed.value.step.ok).toBe(true);
    // Made ready again afterwards: nothing more to fix, nothing counted twice.
    await fly.makeReady(P);
    await fly.check(P);
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect((await log.history()).sessions[0]!.fixed).toEqual([
      { title: 'TrackIR5', group: 'apps', message: 'Started TrackIR5.exe' },
    ]);
  });

  it('launched with something required missing: it says so, and there is no time to ready', async () => {
    app = await wiredApp('flying-pedals-unplugged', { files: [] });
    const { fly, tracker, log } = make();
    await fly.check(P);
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    const history = await log.history();
    expect(history.sessions[0]).toMatchObject({
      notReady: true,
      failedFirst: { title: 'T-Pendular-Rudder', summary: 'Not connected' },
    });
    expect(history.sessions[0]!.readySeconds).toBeUndefined();
    expect(history.totals.notReady).toBe(1);
  });

  it('coming back to the window is a new opening: the time to ready counts from there', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly, tracker, log } = make();
    tracker.presence('main', true);
    await fly.check(P);
    // Left not ready, in the tray, for an hour.
    tracker.presence('main', false);
    app.clock.advance(60 * MINUTE);
    tracker.presence('main', true);
    await fly.check(P);
    app.clock.advance(5000);
    await fly.makeReady(P);
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect((await log.history()).sessions[0]).toMatchObject({ readySeconds: 5 });
  });

  it('a moment in another window is not a new opening: what was wrong and what was fixed stay on the record', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    const { fly, tracker, log } = make();
    tracker.presence('main', true);
    await fly.check(P);
    app.clock.advance(4000);
    // Over to another window for a while less than two minutes, and back.
    tracker.presence('main', false);
    app.clock.advance(AWAY_MS - 1000);
    tracker.presence('main', true);
    await fly.makeReady(P);
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect((await log.history()).sessions[0]).toMatchObject({
      readySeconds: 4 + (AWAY_MS - 1000) / 1000,
      fixed: [{ title: 'TrackIR5' }],
      failedFirst: { title: 'TrackIR5' },
    });
  });

  it('a setup switched to before launching starts its own clock', async () => {
    app = await wiredApp('flying-trackir-not-running', { files: [] });
    await saveProfile({
      id: 'other',
      name: 'Other sim',
      launch: { exe: 'C:\\Games\\Other\\Other.exe', args: [] },
    });
    const { fly, tracker, log } = make();
    await fly.check(P);
    app.clock.advance(60_000);
    await fly.check('other');
    app.clock.advance(2000);
    await fly.launch('other');
    await mutate(app, [{ op: 'stopProcess', name: 'Other.exe' }]);
    await tracker.poll();
    const [session] = (await log.history()).sessions;
    // Nothing of the first setup's trouble is on the second one's record.
    expect(session).toMatchObject({ profileId: 'other', readySeconds: 0, fixed: [] });
    expect(session!.failedFirst).toBeUndefined();
  });
});

describe('welcome back', () => {
  it('with no window on screen, Windows says it; with one on screen, the screen does', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = make();
    await fly.launch(P);
    app.clock.advance(102 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect(notified()).toEqual([
      {
        title: 'Welcome back',
        body: 'DCS F/A-18C: 1 h 42 min. Stand down starts in 1 minute. Open RigReady to cancel.',
      },
    ]);

    // Again, with the window open and saying so.
    await fly.launch(P);
    app.clock.advance(5 * MINUTE);
    expect(tracker.presence('main', true)).toEqual({ attended: true });
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('ended');
    expect(notified()).toHaveLength(1);
  });

  it('a launch that hides RigReady leaves nobody at its window, whatever was done there a moment before', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = make();
    // The click on Launch itself: the user is at the window.
    expect(tracker.presence('main', true)).toEqual({ attended: true });
    const launched = await fly.launch(P);
    expect(launched.ok && launched.value.minimize).toBe(true);
    expect(tracker.presence('compact', false)).toEqual({ attended: false });
    await closeGame();
    await tracker.poll();
    expect(notified()).toHaveLength(1);

    // With hiding switched off the window stays, and so does the user.
    await fly.setPreferences({ minimizeOnLaunch: false });
    tracker.presence('main', true);
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('ended');
    expect(notified()).toHaveLength(1);
  });

  it('a window in the tray is not on screen, and one that stopped saying so for a minute is gone', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = make();
    tracker.presence('main', true);
    expect(tracker.presence('main', false)).toEqual({ attended: false });
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect(notified()).toHaveLength(1);

    // A small window that was closed without a word: its last "on screen" goes stale.
    tracker.presence('compact', true);
    await fly.launch(P);
    app.clock.advance(PRESENCE_MS - 1000);
    expect(tracker.presence('main', false)).toEqual({ attended: true });
    app.clock.advance(2000);
    expect(tracker.presence('main', false)).toEqual({ attended: false });
    await closeGame();
    await tracker.poll();
    expect(notified()).toHaveLength(2);
    // A minute and a second: too short for Stand down to start by itself.
    expect(notified()[1]!.body).toBe('DCS F/A-18C: 1 min. Stand down when you are done.');
  });

  it('Stand down afterwards, or Dismiss, puts the screen back to normal', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = make();
    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('ended');
    const down = await fly.standDown(P);
    expect(down.ok && down.value.headline).toBe('Closed 1 app');
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    expect(states.at(-1)).toEqual({ phase: 'idle' });

    await fly.launch(P);
    await closeGame();
    await tracker.poll();
    expect(tracker.dismiss()).toEqual({ phase: 'idle' });
    // Nothing to dismiss: nothing changes.
    const before = states.length;
    expect(tracker.dismiss()).toEqual({ phase: 'idle' });
    expect(states).toHaveLength(before);
  });

  it('stood down while the game was still open: when it closes there is nothing left to offer', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, log } = make();
    await fly.launch(P);
    app.clock.advance(15 * MINUTE);
    const down = await fly.standDown(P, { closeGame: true });
    expect(down.ok && down.value.steps.map((s) => s.message)).toContain('Closed DCS.exe');
    await tracker.poll();
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    expect(notified()).toEqual([]);
    // The session itself is on the record all the same.
    expect((await log.history()).sessions).toMatchObject([{ durationSeconds: 900 }]);
  });
});

describe('stand down by itself when the game closes', () => {
  /** A session of half an hour that has just closed, with nobody at a window. */
  async function closedAfterHalfAnHour(
    options: TrackerOptions = {}
  ): Promise<ReturnType<typeof make>> {
    const made = make(options);
    made.tracker.presence('main', false);
    await made.fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await made.tracker.poll();
    return made;
  }
  const closedApps = (): string[] => app.ports.processes.closed.map((c) => c.name);

  /**
   * A tracker whose Stand down is the test's own, for what the real one does too fast to
   * be looked at. Ten minutes of the game, then closed, with a countdown of five seconds
   * that is over: the next look runs that Stand down.
   */
  async function countedDown(
    standDown: TrackerDeps['standDown']
  ): Promise<{ tracker: SessionTracker; states: SessionState[] }> {
    const states: SessionState[] = [];
    const tracker = new SessionTracker(
      app.wiring.context,
      new SessionLog(app.ports.files, sessionsDir()),
      {
        emit: (state) => states.push(state),
        standDown,
        standDownOnClose: async () => ({ enabled: true, seconds: 5 }),
        showWindow: async () => {},
      },
      { sleep: () => new Promise(() => {}) }
    );
    await startGame();
    await tracker.launched(
      { id: P, name: 'DCS F/A-18C' },
      { name: 'DCS World', processes: ['DCS.exe'], seen: true }
    );
    app.clock.advance(10 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect(states.at(-1)).toMatchObject({ phase: 'ended', standDownSeconds: 5 });
    app.clock.advance(5000);
    return { tracker, states };
  }

  it('a setup saved before this existed counts down for one minute, then runs Stand down and says what it did', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const saved = await app.wiring.context.profiles.get(P);
    expect(saved.ok && saved.value.extensions).toEqual({});
    const { tracker, states } = await closedAfterHalfAnHour();
    // The countdown: on every screen, with the moment Stand down runs.
    const counting = {
      phase: 'ended',
      profileId: P,
      profileName: 'DCS F/A-18C',
      gameName: 'DCS World',
      startedAt: inMs(-30 * MINUTE),
      endedAt: iso(),
      durationSeconds: 1800,
      standDownAt: inMs(MINUTE),
      standDownSeconds: 60,
    };
    expect(await tracker.current()).toEqual(counting);
    // The window that hid itself for the game is brought back, and Windows says it too.
    expect(app.ports.window.shown).toHaveLength(1);
    expect(notified()).toEqual([
      {
        title: 'Welcome back',
        body: 'DCS F/A-18C: 30 min. Stand down starts in 1 minute. Open RigReady to cancel.',
      },
    ]);

    // One second before the end nothing has been touched.
    app.clock.advance(59_000);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(await tracker.current()).toEqual(counting);

    // Time is up: TrackIR is closed, as the Stand down button does for this setup.
    app.clock.advance(1000);
    await tracker.poll();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    const [running, done] = states.slice(-2);
    expect(running).toMatchObject({ phase: 'ended', standingDown: true });
    expect(running!.standDownAt).toBeUndefined();
    expect(done).toMatchObject({
      phase: 'ended',
      durationSeconds: 1800,
      stoodDown: { finished: true, headline: 'Closed 1 app', failed: 0, problems: [] },
    });
    expect(done!.standingDown).toBeUndefined();
    expect(notified()[1]).toEqual({
      title: 'Welcome back',
      body: 'DCS F/A-18C: 30 min. Stood down: Closed 1 app.',
    });
    // Read and dismissed. Nothing runs a second time.
    expect(tracker.dismiss()).toEqual({ phase: 'idle' });
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
  });

  it('counts down for as long as the setup says', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await setupSays(true, 10);
    const { tracker } = await closedAfterHalfAnHour();
    expect(await tracker.current()).toMatchObject({
      standDownAt: inMs(10_000),
      standDownSeconds: 10,
    });
    expect(notified()[0]!.body).toBe(
      'DCS F/A-18C: 30 min. Stand down starts in 10 seconds. Open RigReady to cancel.'
    );
    app.clock.advance(9000);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    app.clock.advance(1000);
    await tracker.poll();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
  });

  it('a setup that switches it off gets Welcome back and nothing by itself, however long it is left', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await setupSays(false, 10);
    const { tracker, states } = await closedAfterHalfAnHour();
    const ended = await tracker.current();
    expect(ended).toMatchObject({ phase: 'ended', durationSeconds: 1800 });
    expect(ended.standDownAt).toBeUndefined();
    expect(ended.standDownHeld).toBeUndefined();
    expect(app.ports.window.shown).toEqual([]);
    expect(notified()).toEqual([
      { title: 'Welcome back', body: 'DCS F/A-18C: 30 min. Stand down when you are done.' },
    ]);
    const before = states.length;
    app.clock.advance(60 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(states).toHaveLength(before);
    expect(await tracker.current()).toEqual(ended);
  });

  it('Cancel ends the countdown: nothing is closed, and Stand down is still there to press', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = await closedAfterHalfAnHour();
    app.clock.advance(20_000);
    const cancelled = tracker.cancelStandDown();
    expect(cancelled).toMatchObject({ phase: 'ended', standDownHeld: 'cancelled' });
    expect(cancelled.standDownAt).toBeUndefined();
    expect(cancelled.standDownSeconds).toBeUndefined();
    expect(states.at(-1)).toEqual(cancelled);
    // Long after the countdown would have ended: nothing was closed, nothing was said.
    app.clock.advance(10 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(await tracker.current()).toEqual(cancelled);
    expect(notified()).toHaveLength(1);
    // Cancel again: there is nothing to cancel, and nothing changes.
    const before = states.length;
    expect(tracker.cancelStandDown()).toEqual(cancelled);
    expect(states).toHaveLength(before);
    // The button still does its work.
    const down = await fly.standDown(P);
    expect(down.ok && down.value.headline).toBe('Closed 1 app');
    expect(await tracker.current()).toEqual({ phase: 'idle' });
  });

  it('Cancel after Stand down has started changes nothing: the answer says it is running', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    let finish = (): void => {};
    const { tracker, states } = await countedDown(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(ok({ headline: 'Closed 1 app', failed: 0, problems: [] }));
        })
    );
    const run = tracker.poll();
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ standingDown: true }));
    const answer = tracker.cancelStandDown();
    expect(answer).toMatchObject({ phase: 'ended', standingDown: true });
    expect(answer.standDownHeld).toBeUndefined();
    // Dismiss does not hide a Stand down that is running either.
    expect(tracker.dismiss()).toMatchObject({ phase: 'ended', standingDown: true });
    // Its own start and end are not taken for a Stand down pressed by hand.
    tracker.standDownStarted();
    tracker.stoodDown();
    expect(await tracker.current()).toMatchObject({ phase: 'ended', standingDown: true });
    finish();
    await run;
    expect(await tracker.current()).toMatchObject({
      phase: 'ended',
      stoodDown: { finished: true, headline: 'Closed 1 app', failed: 0 },
    });
    expect((await tracker.current()).standingDown).toBeUndefined();
  });

  it('Play pressed while Stand down runs by itself: the new session keeps the screen, and the old result is not shown over it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    let finish = (): void => {};
    const { tracker, states } = await countedDown(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(ok({ headline: 'Closed 1 app', failed: 0, problems: [] }));
        })
    );
    const run = tracker.poll();
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ standingDown: true }));
    await startGame();
    await tracker.launched(
      { id: P, name: 'DCS F/A-18C' },
      { name: 'DCS World', processes: ['DCS.exe'], seen: true }
    );
    finish();
    await run;
    expect(await tracker.current()).toMatchObject({ phase: 'running', startedAt: iso() });
    expect(states.some((s) => s.stoodDown)).toBe(false);
    expect(notified()).toHaveLength(1);
  });

  it('the game running again during the countdown ends the countdown and is a new session', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { tracker, log } = await closedAfterHalfAnHour();
    app.clock.advance(30_000);
    await startGame();
    await tracker.poll();
    const restarted = iso();
    const running = await tracker.current();
    expect(running).toEqual({
      phase: 'running',
      profileId: P,
      profileName: 'DCS F/A-18C',
      gameName: 'DCS World',
      startedAt: restarted,
    });
    // It is on disk as the session in progress, so a restart of RigReady picks it up.
    expect(await log.current()).toMatchObject({ ok: true, value: { startedAt: restarted } });
    // Past the end of the countdown, with the game running: nothing is stood down.
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect((await tracker.current()).phase).toBe('running');

    // The second session closes later and has its own countdown.
    app.clock.advance(20 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({
      phase: 'ended',
      startedAt: restarted,
      durationSeconds: 25 * 60,
      standDownAt: inMs(MINUTE),
    });
    expect((await log.history()).sessions).toMatchObject([
      { startedAt: restarted, durationSeconds: 25 * 60 },
      { durationSeconds: 30 * 60 },
    ]);
  });

  it('a game that closes within two minutes of starting starts no countdown, and the screen is told why', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = make();
    tracker.presence('main', false);
    await fly.launch(P);
    app.clock.advance(QUICK_EXIT_MS - 1000);
    await closeGame();
    await tracker.poll();
    const ended = await tracker.current();
    expect(ended).toMatchObject({ phase: 'ended', standDownHeld: 'quickExit' });
    expect(ended.standDownAt).toBeUndefined();
    expect(app.ports.window.shown).toEqual([]);
    expect(notified()).toEqual([
      { title: 'Welcome back', body: 'DCS F/A-18C: 1 min. Stand down when you are done.' },
    ]);
    app.clock.advance(10 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(await tracker.current()).toEqual(ended);

    // Two minutes exactly is a session: it counts down.
    await fly.launch(P);
    app.clock.advance(QUICK_EXIT_MS);
    await closeGame();
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({ standDownAt: inMs(MINUTE) });
  });

  it('a launcher that exits while the real game runs is one session: it ends when the last known program is gone', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = make();
    await fly.launch(P);
    const started = iso();
    // DCS.exe hands over to the multithreaded program and exits.
    app.clock.advance(20_000);
    await mutate(app, [
      { op: 'startProcess', name: 'DCS_mt.exe', path: 'C:\\Games\\DCS\\bin-mt\\DCS_mt.exe' },
    ]);
    await closeGame();
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({ phase: 'running', startedAt: started });
    app.clock.advance(40 * MINUTE);
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('running');
    expect(closedApps()).toEqual([]);
    await mutate(app, [{ op: 'stopProcess', name: 'DCS_mt.exe' }]);
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({
      phase: 'ended',
      startedAt: started,
      standDownAt: inMs(MINUTE),
    });
  });

  it('a launcher that exits a moment before the real game shows up: no countdown, and the game is a session when it runs', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, log } = make();
    await fly.launch(P);
    app.clock.advance(20_000);
    await closeGame();
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({ phase: 'ended', standDownHeld: 'quickExit' });
    // Eight seconds with nothing running, then the game itself.
    app.clock.advance(8000);
    await tracker.poll();
    await mutate(app, [
      { op: 'startProcess', name: 'DCS_mt.exe', path: 'C:\\Games\\DCS\\bin-mt\\DCS_mt.exe' },
    ]);
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({ phase: 'running', startedAt: iso() });
    expect(closedApps()).toEqual([]);
    app.clock.advance(45 * MINUTE);
    await mutate(app, [{ op: 'stopProcess', name: 'DCS_mt.exe' }]);
    await tracker.poll();
    expect(await tracker.current()).toMatchObject({ durationSeconds: 45 * 60 });
    expect((await log.history()).sessions).toMatchObject([
      { durationSeconds: 45 * 60 },
      { durationSeconds: 20 },
    ]);
  });

  it('with no countdown running, RigReady stops looking for the game after a quarter of an hour', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await setupSays(false, 60);
    const { tracker, states } = await closedAfterHalfAnHour();
    const ended = await tracker.current();
    app.clock.advance(LOOK_BACK_MS);
    await tracker.poll();
    // A game started now was not started from here: it is not a session.
    await startGame();
    const before = states.length;
    await tracker.poll();
    expect(states).toHaveLength(before);
    expect(await tracker.current()).toEqual(ended);
  });

  it('Stand down pressed by hand during the countdown ends the countdown: one Stand down runs, not two', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = await closedAfterHalfAnHour();
    app.clock.advance(15_000);
    const before = states.length;
    const down = await fly.standDown(P);
    expect(down.ok && down.value.headline).toBe('Closed 1 app');
    // The countdown left the screen the moment Stand down started.
    expect(states[before]).toMatchObject({ phase: 'ended' });
    expect(states[before]!.standDownAt).toBeUndefined();
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    // Past the moment the countdown would have ended: nothing runs again.
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    // Nothing is said by Windows about a Stand down the user ran at the screen.
    expect(notified()).toHaveLength(1);
  });

  it('a second Stand down while one is running is refused: it does not run on top of the first', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly } = make();
    await fly.launch(P);
    const first = fly.standDown(P);
    const second = await fly.standDown(P);
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'fly.standDownRunning', message: 'Stand down is already running.' },
    });
    const done = await first;
    expect(done.ok && done.value.headline).toBe('Closed 1 app');
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    // Once it has finished, Stand down can be run again.
    expect((await fly.standDown(P)).ok).toBe(true);
  });

  it('Dismiss, or Play again, during the countdown: nothing is stood down', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker } = await closedAfterHalfAnHour();
    expect(tracker.dismiss()).toEqual({ phase: 'idle' });
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);

    // Again, and this time Play is pressed while it counts down.
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).standDownAt).toBeDefined();
    app.clock.advance(30_000);
    await fly.launch(P);
    expect(await tracker.current()).toMatchObject({ phase: 'running', startedAt: iso() });
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect((await tracker.current()).phase).toBe('running');
  });

  it('Play pressed late in the countdown ends it at once: nothing is stood down while the launch is still under way', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = await closedAfterHalfAnHour();
    // 50 s into the minute. The game then takes 15 s to start, longer than what is left of
    // the countdown, and the watch loop looks at the process list meanwhile, as it does
    // every 2 s in the app.
    app.clock.advance(50_000);
    const processes = app.wiring.context.ports.processes;
    const start = processes.start.bind(processes);
    const atStart: SessionState[] = [];
    processes.start = async (target) => {
      atStart.push(await tracker.current());
      app.clock.advance(15_000);
      await tracker.poll();
      return start(target);
    };
    const launched = await fly.launch(P);
    expect(launched.ok && launched.value.outcome).toBe('launched');
    // Nothing the launch needs was closed, and no Stand down ran or was reported.
    expect(closedApps()).toEqual([]);
    expect(states.some((s) => s.standingDown || s.stoodDown)).toBe(false);
    // The countdown was over before the game was started, and the screen said so.
    expect(atStart[0]).toMatchObject({ phase: 'ended', standDownHeld: 'cancelled' });
    expect(atStart[0]!.standDownAt).toBeUndefined();
    expect(await tracker.current()).toMatchObject({ phase: 'running', startedAt: iso() });
    expect(notified()).toHaveLength(1);
  });

  it('Make ready or a fix during the countdown ends it before it changes anything; a check does not', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = await closedAfterHalfAnHour();
    app.clock.advance(20_000);
    // The Play screen checks again every few seconds by itself: that is no reason to stop.
    expect((await fly.check(P)).ok).toBe(true);
    expect((await tracker.current()).standDownAt).toBeDefined();
    expect((await fly.makeReady(P)).ok).toBe(true);
    expect(await tracker.current()).toMatchObject({ phase: 'ended', standDownHeld: 'cancelled' });
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);

    // Another session, and this time one item's fix is pressed during the countdown.
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).standDownAt).toBeDefined();
    app.clock.advance(20_000);
    await fly.fix(P, 'c13', true);
    expect(await tracker.current()).toMatchObject({ phase: 'ended', standDownHeld: 'cancelled' });
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(states.some((s) => s.standingDown || s.stoodDown)).toBe(false);
  });

  it('Play, Make ready and a fix do not run beside a Stand down that is running: nothing is started under it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly } = make();
    await fly.launch(P);
    const startedBefore = app.ports.processes.started.length;
    const down = fly.standDown(P);
    const refused = {
      ok: false,
      error: { code: 'fly.standDownRunning', message: 'Stand down is running.' },
    };
    const [launch, ready, fix] = await Promise.all([
      fly.launch(P),
      fly.makeReady(P),
      fly.fix(P, 'c13', true),
    ]);
    expect(launch).toMatchObject(refused);
    expect(ready).toMatchObject(refused);
    expect(fix).toMatchObject(refused);
    const done = await down;
    expect(done.ok && done.value.headline).toBe('Closed 1 app');
    expect(app.ports.processes.started).toHaveLength(startedBefore);
    // Once it has finished, they run again.
    expect((await fly.makeReady(P)).ok).toBe(true);
  });

  it('Stand down pressed by hand with "close the game": no countdown starts under it, the window stays where it is, and Windows is told nothing more', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await setupSays(true, 5);
    const { fly, tracker, log, states } = make();
    tracker.presence('main', false);
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    // The watch loop looks while that Stand down is still at work: the game is gone, and
    // the rest of Stand down has not run yet. Then again, past the end of a countdown.
    const processes = app.wiring.context.ports.processes;
    const close = processes.close.bind(processes);
    let looked = false;
    processes.close = async (pid, options) => {
      const closed = await close(pid, options);
      const list = await processes.list();
      const gone = list.ok && !list.value.some((p) => p.name.toLowerCase() === 'dcs.exe');
      if (gone && !looked) {
        looked = true;
        await tracker.poll();
        app.clock.advance(6000);
        await tracker.poll();
      }
      return closed;
    };
    const down = await fly.standDown(P, { closeGame: true });
    expect(looked).toBe(true);
    expect(down.ok && down.value.headline).toBe('Closed 2 apps');
    expect(closedApps()).toEqual(['TrackIR5.exe', 'DCS.exe']);
    // No countdown, no window brought up for one, no Stand down by itself.
    expect(states.some((s) => s.standDownAt !== undefined)).toBe(false);
    expect(states.some((s) => s.standingDown || s.stoodDown)).toBe(false);
    expect(app.ports.window.shown).toEqual([]);
    expect(notified()).toEqual([]);
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    // The session is on the record with its length.
    expect((await log.history()).sessions).toMatchObject([{ durationSeconds: 1800 }]);
    // Once that Stand down is over, a game that closes by itself counts down again.
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).standDownSeconds).toBe(5);
  });

  it('RigReady quit during the countdown: nothing is stood down then or at the next start, and nothing says it was', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { tracker, states } = await closedAfterHalfAnHour();
    tracker.stop();
    app.clock.advance(5 * MINUTE);
    await tracker.poll();
    expect(closedApps()).toEqual([]);
    expect(states.some((s) => s.standingDown || s.stoodDown)).toBe(false);

    // RigReady starts again: the session is in the history, and nothing is under way.
    const again = make();
    expect(await again.tracker.current()).toEqual({ phase: 'idle' });
    await again.tracker.poll();
    expect(closedApps()).toEqual([]);
    expect((await again.log.history()).sessions).toMatchObject([{ durationSeconds: 1800 }]);
    expect(notified()).toHaveLength(1);
  });

  it('when the running programs cannot be read at the end of the countdown, Stand down waits for a look that works', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { tracker } = await closedAfterHalfAnHour();
    const list = app.ports.processes.list.bind(app.ports.processes);
    app.ports.processes.list = async () => err('process.list', 'Could not list running programs.');
    app.clock.advance(MINUTE + 5000);
    await tracker.poll();
    // Whether the game is back is not known: nothing is closed, and nothing says it was.
    expect(closedApps()).toEqual([]);
    const waiting = await tracker.current();
    expect(waiting.standDownAt).toBeDefined();
    expect(waiting.standingDown).toBeUndefined();
    app.ports.processes.list = list;
    await tracker.poll();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    expect(await tracker.current()).toMatchObject({ stoodDown: { finished: true } });
  });

  it('a step that did not work is named: it never reads as stood down', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    app.ports.processes.stubborn.add('trackir5.exe');
    const { tracker } = await closedAfterHalfAnHour();
    app.clock.advance(MINUTE);
    await tracker.poll();
    const down = (await tracker.current()).stoodDown!;
    expect(down).toMatchObject({ finished: true, failed: 1 });
    expect(down.headline).toBe('No apps to close · 1 step needs attention');
    expect(down.problems).toHaveLength(1);
    expect(down.problems[0]).toMatch(/^TrackIR5\.exe is still running/);
    expect(notified()[1]!.body).toMatch(
      /^DCS F\/A-18C: 30 min\. Stand down ran, but 1 step needs attention: TrackIR5\.exe is still running/
    );
    expect(notified()[1]!.body).not.toMatch(/Stood down/);
  });

  it('a Stand down that cannot run says why instead of "stood down"', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { tracker, states } = await closedAfterHalfAnHour();
    // The setup's file is gone by the time the countdown ends.
    await fs.rm(app.wiring.context.profiles.fileFor(P));
    app.clock.advance(MINUTE);
    await tracker.poll();
    const down = states.at(-1)!.stoodDown!;
    expect(down).toMatchObject({
      finished: false,
      headline: 'Stand down did not finish',
      failed: 1,
    });
    expect(down.problems).toHaveLength(1);
    expect(down.problems[0]).not.toBe('');
    expect(notified()[1]!.body).toBe(
      `DCS F/A-18C: 30 min. Stand down did not finish: ${down.problems[0]}`
    );
    expect(closedApps()).toEqual([]);
  });

  it('a Stand down that throws is said the same way, and the next one can still run', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { tracker, states } = await countedDown(async () => {
      throw new Error('The helper stopped.');
    });
    await tracker.poll();
    expect(states.at(-1)).toMatchObject({
      phase: 'ended',
      stoodDown: {
        finished: false,
        headline: 'Stand down did not finish',
        failed: 1,
        problems: ['The helper stopped.'],
      },
    });
    expect(states.at(-1)!.standingDown).toBeUndefined();
    // The tracker is not left "standing down" for ever: a Stand down by hand is noticed.
    tracker.stoodDown();
    expect(states.at(-1)).toEqual({ phase: 'idle' });
  });

  it('looks again every few seconds while it counts down, and not later than the end of the countdown', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await setupSays(true, 5);
    const waits: { ms: number; wake: () => void }[] = [];
    const { fly, states } = make({
      sleep: (ms) => new Promise<void>((wake) => waits.push({ ms, wake })),
    });
    await fly.launch(P);
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    app.clock.advance(30 * MINUTE);
    await closeGame();
    waits[0]!.wake();
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ standDownSeconds: 5 }));
    await vi.waitFor(() => expect(waits).toHaveLength(2));
    expect(waits[1]!.ms).toBe(2000);
    app.clock.advance(2000);
    waits[1]!.wake();
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    expect(waits[2]!.ms).toBe(2000);
    app.clock.advance(2000);
    waits[2]!.wake();
    // One second is left: it does not sleep past it.
    await vi.waitFor(() => expect(waits).toHaveLength(4));
    expect(waits[3]!.ms).toBe(1000);
    expect(closedApps()).toEqual([]);
    app.clock.advance(1000);
    waits[3]!.wake();
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ stoodDown: { finished: true } }));
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    // It is over: nobody is waiting any more.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits).toHaveLength(4);
  });
});

describe('the countdown and the desk layout', () => {
  const NOT_KEPT_YET =
    'The desk layout "Desk" has not been kept with these monitors yet. Stay and press Keep it when RigReady asks, or the monitors stay as they are.';
  const closedApps = (): string[] => app.ports.processes.closed.map((c) => c.name);

  /**
   * Flying, with a desk layout "Desk" that has only the ultrawide on: what Stand down
   * applies differs from the monitors as they are. Hands back the flying arrangement.
   */
  async function withDeskLayout(): Promise<{ id: string; flying: () => Promise<void> }> {
    app = await wiredApp('flying-all-good', { files: [] });
    const read = await app.ports.displays.read();
    if (!read.ok) throw new Error('read failed');
    const flyingTargets = read.value.displays.map((d) => ({ ...d }));
    const view = await app.invoke<{ monitors: { id: string; name: string }[] }>('displays:view');
    const ultrawide = view.monitors.find((m) => m.name === 'LC49G95T')!;
    const made = await app.invoke<{ layouts: { id: string; name: string }[] }>(
      'displays:newLayout',
      { name: 'Desk', stayOn: [ultrawide.id] }
    );
    const id = made.layouts.find((l) => l.name === 'Desk')!.id;
    await app.invoke('displays:setDeskLayout', { id });
    return {
      id,
      flying: async () => {
        const back = await app.ports.displays.apply(flyingTargets);
        if (!back.ok) throw new Error(back.error.message);
      },
    };
  }

  /** Half an hour of the game, then closed, with nobody at a window. */
  async function session(made: ReturnType<typeof make>): Promise<void> {
    made.tracker.presence('main', false);
    await made.fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await made.tracker.poll();
  }

  it('says, with the countdown and in Windows, when the desk layout has not been kept with these monitors yet; once kept it says nothing', async () => {
    const desk = await withDeskLayout();
    const made = make();
    await session(made);
    expect(await made.tracker.current()).toMatchObject({
      phase: 'ended',
      standDownSeconds: 60,
      standDownNeedsYou: [NOT_KEPT_YET],
    });
    expect(notified()).toEqual([
      {
        title: 'Welcome back',
        body: `DCS F/A-18C: 30 min. Stand down starts in 1 minute. Open RigReady to cancel. ${NOT_KEPT_YET}`,
      },
    ]);

    // Time is up. Stand down asks about Desk, and somebody stayed and kept it.
    app.clock.advance(MINUTE);
    await made.tracker.poll();
    expect(made.states.at(-1)).toMatchObject({
      stoodDown: { finished: true, failed: 0 },
    });
    expect(made.states.at(-1)!.standDownNeedsYou).toBeUndefined();
    expect(closedApps()).toEqual(['TrackIR5.exe']);
    made.tracker.dismiss();

    // Another evening: flying again, then the game closes. Desk was kept with these
    // monitors, so Stand down will not ask, and the countdown has nothing to warn of.
    await desk.flying();
    await startGame();
    await session(made);
    const counting = await made.tracker.current();
    expect(counting).toMatchObject({ phase: 'ended', standDownSeconds: 60 });
    expect(counting.standDownNeedsYou).toBeUndefined();
    expect(notified()[2]!.body).toBe(
      'DCS F/A-18C: 30 min. Stand down starts in 1 minute. Open RigReady to cancel.'
    );
  });

  it('a Stand down nobody stayed for: the desk layout goes back, and the result says what to do next time', async () => {
    await withDeskLayout();
    const made = make();
    await session(made);
    expect((await made.tracker.current()).standDownNeedsYou).toEqual([NOT_KEPT_YET]);
    app.layoutAnswer = 'revert';
    app.clock.advance(MINUTE);
    await made.tracker.poll();
    expect(made.states.at(-1)).toMatchObject({
      stoodDown: {
        finished: true,
        failed: 1,
        problems: [
          'Desk monitor layout: The new monitor layout was not kept, so the previous one is back. Next time, stay for the question and press Keep it.',
        ],
      },
    });
  });

  it('a Replace with the monitors as they are counts as kept: nothing to warn of', async () => {
    const desk = await withDeskLayout();
    const made = make();
    /** Only the ultrawide on, set up in Windows' own settings: RigReady asked nothing. */
    const deskInWindows = (): Promise<void> =>
      mutate(app, [
        { op: 'setDisplay', match: { name: 'USB_Monitor', index: 0 }, set: { enabled: false } },
        { op: 'setDisplay', match: { name: 'USB_Monitor', index: 1 }, set: { enabled: false } },
        { op: 'setDisplay', match: { name: 'USB_Monitor', index: 2 }, set: { enabled: false } },
      ]);
    await deskInWindows();
    await desk.flying();
    expect(await made.fly.standDownNeedsYou(P)).toEqual([NOT_KEPT_YET]);

    // At the desk again, Desk is replaced with the monitors as they are.
    await deskInWindows();
    await app.invoke('displays:updateLayout', { id: desk.id });
    await desk.flying();
    expect(await made.fly.standDownNeedsYou(P)).toEqual([]);
    await session(made);
    expect((await made.tracker.current()).standDownNeedsYou).toBeUndefined();
    // And the Stand down after the countdown asks nothing.
    app.layoutAnswer = 'wait';
    const asked = app.events.filter((e) => e.channel === 'displays:event:applied').length;
    app.clock.advance(MINUTE);
    await made.tracker.poll();
    expect(made.states.at(-1)).toMatchObject({ stoodDown: { finished: true, failed: 0 } });
    expect(app.events.filter((e) => e.channel === 'displays:event:applied')).toHaveLength(asked);
  });

  it('never holds the countdown up: what Stand down will need is left unsaid when it does not come in time', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const states: SessionState[] = [];
    const tracker = new SessionTracker(
      app.wiring.context,
      new SessionLog(app.ports.files, sessionsDir()),
      {
        emit: (state) => states.push(state),
        standDown: async () => ok({ headline: 'Closed 1 app', failed: 0, problems: [] }),
        standDownOnClose: async () => ({ enabled: true, seconds: 60 }),
        // A monitor read that never answers.
        standDownNeedsYou: () => new Promise(() => {}),
        showWindow: async () => {},
      },
      { sleep: () => new Promise(() => {}), needsYouMs: 20 }
    );
    await startGame();
    await tracker.launched(
      { id: P, name: 'DCS F/A-18C' },
      { name: 'DCS World', processes: ['DCS.exe'], seen: true }
    );
    app.clock.advance(10 * MINUTE);
    await closeGame();
    await tracker.poll();
    const counting = states.at(-1)!;
    expect(counting).toMatchObject({ phase: 'ended', standDownSeconds: 60 });
    expect(counting.standDownNeedsYou).toBeUndefined();

    // And one that fails says nothing either.
    const failing = new SessionTracker(
      app.wiring.context,
      new SessionLog(app.ports.files, sessionsDir()),
      {
        emit: (state) => states.push(state),
        standDown: async () => ok({ headline: 'Closed 1 app', failed: 0, problems: [] }),
        standDownOnClose: async () => ({ enabled: true, seconds: 60 }),
        standDownNeedsYou: async () => {
          throw new Error('The monitors could not be read.');
        },
        showWindow: async () => {},
      },
      { sleep: () => new Promise(() => {}) }
    );
    await startGame();
    await failing.launched(
      { id: P, name: 'DCS F/A-18C' },
      { name: 'DCS World', processes: ['DCS.exe'], seen: true }
    );
    app.clock.advance(10 * MINUTE);
    await closeGame();
    await failing.poll();
    expect(states.at(-1)).toMatchObject({ phase: 'ended', standDownSeconds: 60 });
    expect(states.at(-1)!.standDownNeedsYou).toBeUndefined();
    tracker.stop();
    failing.stop();
  });
});

describe('a game started through Steam', () => {
  it('is a session from the moment the game itself runs, not from the hand-off', async () => {
    app = await wiredApp('flying-all-good');
    await saveProfile({
      id: 'steam',
      name: 'DCS through Steam',
      game: 'dcs',
      steamAppId: '223750',
    });
    const { fly, tracker, log } = make();
    const launched = await fly.launch('steam');
    expect(launched.ok && launched.value).toMatchObject({
      outcome: 'launched',
      message: 'Asked Steam to start DCS through Steam',
    });
    expect(await tracker.current()).toMatchObject({ phase: 'starting', profileId: 'steam' });
    // Steam is updating: nothing yet.
    app.clock.advance(90_000);
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('starting');
    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'D:\\Steam\\DCS.exe' }]);
    await tracker.poll();
    const running = await tracker.current();
    expect(running).toMatchObject({ phase: 'running', startedAt: iso() });
    app.clock.advance(50 * MINUTE);
    await closeGame();
    await tracker.poll();
    expect((await log.history()).sessions).toMatchObject([
      { profileId: 'steam', startedAt: running.startedAt, durationSeconds: 3000 },
    ]);
  });

  it('that never shows up is not a session: after a quarter of an hour RigReady stops waiting', async () => {
    app = await wiredApp('flying-all-good');
    await saveProfile({
      id: 'steam',
      name: 'DCS through Steam',
      game: 'dcs',
      steamAppId: '223750',
    });
    const { fly, tracker, log, states } = make();
    await fly.launch('steam');
    app.clock.advance(14 * MINUTE);
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('starting');
    app.clock.advance(2 * MINUTE);
    await tracker.poll();
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    expect(states.at(-1)).toEqual({ phase: 'idle' });
    expect((await log.history()).sessions).toEqual([]);
    expect((await log.current()).ok && (await log.current())).toEqual({ ok: true });
    expect(notified()).toEqual([]);
  });

  it('whose programs RigReady does not know is recorded as launched, without a length', async () => {
    app = await wiredApp('flying-all-good');
    await saveProfile({
      id: 'unknown',
      name: 'Some other game',
      game: 'other',
      gameName: 'Star Hauler',
      steamAppId: '99999',
    });
    const { fly, tracker, log } = make();
    await fly.launch('unknown');
    expect(await tracker.current()).toEqual({ phase: 'idle' });
    const history = await log.history();
    expect(history.sessions).toMatchObject([
      { profileId: 'unknown', gameName: 'Star Hauler', startedAt: iso() },
    ]);
    expect(history.sessions[0]!.durationSeconds).toBeUndefined();
    expect(history.line).toBe('1 session, 0 min');
    const state = await fly.state();
    const summary = state.ok ? state.value.profiles.find((p) => p.id === 'unknown') : undefined;
    expect(summary).toMatchObject({ lastSession: { startedAt: iso() } });
    expect(summary!.lastSession!.durationSeconds).toBeUndefined();
    expect(summary!.kind).toBeUndefined();
  });
});

describe('RigReady closed in the middle of a session', () => {
  it('picks the session up again when the game is still running', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const first = make();
    await first.fly.launch(P);
    const started = iso();
    first.tracker.stop();
    app.clock.advance(40 * MINUTE);

    // RigReady starts again.
    const again = make();
    expect(await again.tracker.current()).toMatchObject({ phase: 'running', startedAt: started });
    app.clock.advance(20 * MINUTE);
    await closeGame();
    await again.tracker.poll();
    expect((await again.log.history()).sessions).toMatchObject([
      { startedAt: started, durationSeconds: 3600 },
    ]);
  });

  it('records it without a length when the game closed meanwhile: when is not known', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const first = make();
    await first.fly.launch(P);
    const started = iso();
    first.tracker.stop();
    await closeGame();
    app.clock.advance(3 * 60 * MINUTE);

    const again = make();
    expect(await again.tracker.current()).toEqual({ phase: 'idle' });
    const history = await again.log.history();
    expect(history.sessions).toMatchObject([{ startedAt: started }]);
    expect(history.sessions[0]!.durationSeconds).toBeUndefined();
    // And only once.
    expect(await make().tracker.current()).toEqual({ phase: 'idle' });
    expect((await again.log.history()).sessions).toHaveLength(1);
    expect(notified()).toEqual([]);
  });
});

describe('the history file', () => {
  const record = (n: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
    id: `s${n}`,
    profileId: P,
    profileName: 'DCS F/A-18C',
    startedAt: new Date(Date.parse('2026-09-01T18:00:00.000Z') + n * 86_400_000).toISOString(),
    durationSeconds: 3600,
    fixed: [],
    ...extra,
  });

  it('with no file there is no history, and asking does not create one', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const log = new SessionLog(app.ports.files, sessionsDir());
    expect(await log.history()).toEqual({
      sessions: [],
      totals: { sessions: 0, seconds: 0, fixes: [], notReady: 0 },
      line: 'No sessions yet',
    });
    expect(await log.lastByProfile()).toEqual({});
    await expect(fs.readdir(sessionsDir())).rejects.toThrow();
  });

  it('lists the newest first and adds up hours, fixes and the usual time to ready', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const log = new SessionLog(app.ports.files, sessionsDir());
    const trackir = { title: 'TrackIR', group: 'apps' as const, message: 'Started TrackIR5.exe' };
    const layout = { title: 'Monitor layout', group: 'displays' as const, message: 'Applied' };
    await log.finish(record(1, { readySeconds: 4, fixed: [trackir] }));
    await log.finish(record(2, { readySeconds: 40, fixed: [trackir, layout], notReady: true }));
    await log.finish(record(3, { readySeconds: 9, profileId: 'huey', durationSeconds: 1800 }));
    await log.finish(record(4, { fixed: [layout, trackir] }));
    const { durationSeconds: _unknown, ...lengthUnknown } = record(5);
    await log.finish(lengthUnknown);
    const history = await log.history();
    expect(history.sessions.map((s) => s.id)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(history.totals).toEqual({
      sessions: 5,
      seconds: 3 * 3600 + 1800,
      fixes: [
        { title: 'TrackIR', group: 'apps', count: 3 },
        { title: 'Monitor layout', group: 'displays', count: 2 },
      ],
      readySeconds: 9,
      notReady: 1,
    });
    expect(history.line).toBe('5 sessions, 3 h 30 min; TrackIR needed starting 3 times');
    expect(await log.lastByProfile()).toEqual({
      [P]: { startedAt: record(5).startedAt },
      huey: { startedAt: record(3).startedAt, durationSeconds: 1800 },
    });
    expect(sessionTotals([]).readySeconds).toBeUndefined();
  });

  it('keeps the newest thousand, and lists the newest hundred', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, n) => record(n));
    await fs.mkdir(sessionsDir(), { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir(), 'sessions.json'),
      JSON.stringify({ sessions: many.slice(0, MAX_SESSIONS) })
    );
    const log = new SessionLog(app.ports.files, sessionsDir());
    for (const extra of many.slice(MAX_SESSIONS)) await log.finish(extra);
    const history = await log.history();
    expect(history.totals.sessions).toBe(MAX_SESSIONS);
    expect(history.sessions).toHaveLength(HISTORY_LISTED);
    expect(history.sessions[0]!.id).toBe(`s${MAX_SESSIONS + 4}`);
    const kept = JSON.parse(
      await fs.readFile(path.join(sessionsDir(), 'sessions.json'), 'utf8')
    ) as { sessions: SessionRecord[] };
    expect(kept.sessions[0]!.id).toBe('s5');
  });

  it('changes made at the same moment are all kept: none reads the history before the one ahead of it has written', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const log = new SessionLog(app.ports.files, sessionsDir());
    // A game closes as the next one is launched: the session that ended, the one that
    // begins and the one after it, with nothing waited for in between.
    const results = await Promise.all([
      log.finish(record(1)),
      log.setCurrent({ ...record(2), processes: ['DCS.exe'] }),
      log.finish(record(2)),
      log.finish(record(3)),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true, true]);
    const history = await log.history();
    expect(history.sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect(await log.current()).toEqual({ ok: true, value: undefined });
  });

  it('a damaged file is left exactly as it is, named, and the history goes on in the next one', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await fs.mkdir(sessionsDir(), { recursive: true });
    const damaged = path.join(sessionsDir(), 'sessions.json');
    await fs.writeFile(damaged, '{ "sessions": [ { "id": "cut off');
    const log = new SessionLog(app.ports.files, sessionsDir());
    expect((await log.history()).sessions).toEqual([]);
    expect((await log.finish(record(1))).ok).toBe(true);
    expect(await fs.readFile(damaged, 'utf8')).toBe('{ "sessions": [ { "id": "cut off');
    const history = await log.history();
    expect(history.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(history.notice).toBe(
      'sessions.json could not be read and was left as it is; the history continues in sessions.1.json.'
    );
    expect(await fs.readdir(sessionsDir())).toEqual(['sessions.1.json', 'sessions.json']);

    // Wrong shape, not only wrong JSON: the same.
    await fs.writeFile(path.join(sessionsDir(), 'sessions.1.json'), '{ "sessions": "none" }');
    await log.finish(record(2));
    expect((await log.history()).notice).toBe(
      'sessions.json, sessions.1.json could not be read and were left as they are; the history continues in sessions.2.json.'
    );
    expect((await log.history()).sessions.map((s) => s.id)).toEqual(['s2']);
  });

  it('when every file is damaged it says so, writes nothing, and a session still runs', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await fs.mkdir(sessionsDir(), { recursive: true });
    const names = ['sessions.json', ...[1, 2, 3, 4].map((n) => `sessions.${n}.json`)];
    for (const name of names) await fs.writeFile(path.join(sessionsDir(), name), 'not json');
    const { fly, tracker, log } = make();
    const history = await log.history();
    expect(history.sessions).toEqual([]);
    expect(history.notice).toMatch(/^The session history cannot be read\. sessions\.json, /);
    expect(history.notice).toContain('were left as they are');
    await fly.launch(P);
    expect((await tracker.current()).phase).toBe('running');
    await closeGame();
    await tracker.poll();
    expect((await tracker.current()).phase).toBe('ended');
    for (const name of names) {
      expect(await fs.readFile(path.join(sessionsDir(), name), 'utf8')).toBe('not json');
    }
    expect((await fs.readdir(sessionsDir())).sort()).toEqual([...names].sort());
    expect(await log.lastByProfile()).toEqual({});
  });

  it('a file that cannot be read right now is not skipped: nothing is written beside it', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const log = new SessionLog(app.ports.files, sessionsDir());
    await log.finish(record(1));
    const readText = app.ports.files.readText.bind(app.ports.files);
    app.ports.files.readText = async (file) =>
      file.endsWith('sessions.json')
        ? err('file.read', 'The file is in use by another program.')
        : readText(file);
    const refused = await log.finish(record(2));
    expect(refused).toMatchObject({ ok: false, error: { code: 'file.read' } });
    expect((await log.history()).notice).toBe('The file is in use by another program.');
    app.ports.files.readText = readText;
    expect(await fs.readdir(sessionsDir())).toEqual(['sessions.json']);
    expect((await log.history()).sessions.map((s) => s.id)).toEqual(['s1']);
  });
});
