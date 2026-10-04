import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import { err, ok } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { SessionRecord, SessionState } from '../contract';
import { Fly } from './fly';
import {
  AWAY_MS,
  HISTORY_LISTED,
  MAX_SESSIONS,
  PRESENCE_MS,
  SessionLog,
  sessionTotals,
  SessionTracker,
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
        const down = await fly.standDown(profileId);
        if (!down.ok) return down;
        return ok({
          headline: down.value.headline,
          failed: down.value.steps.filter((s) => !s.ok && !s.skipped).length,
        });
      },
      autoStandDown: async () => {
        const preferences = await fly.preferences();
        return preferences.ok && preferences.value.autoStandDown;
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
    // Nothing more happens by itself.
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
    // The session is over: nobody is waiting any more.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits).toHaveLength(2);

    // A second session, and RigReady quits in the middle of it: the loop ends with it.
    await fly.launch(P);
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    tracker.stop();
    await closeGame();
    waits[2]!.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits).toHaveLength(3);
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
        body: 'DCS F/A-18C: 1 h 42 min. Stand down when you are done.',
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

  it('stands down by itself when asked to, says what it did, and leaves the welcome on screen', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = make();
    expect((await fly.preferences()).ok && (await fly.preferences())).toMatchObject({
      value: { autoStandDown: false },
    });
    await fly.setPreferences({ autoStandDown: true });
    tracker.presence('main', false);
    await fly.launch(P);
    app.clock.advance(30 * MINUTE);
    await closeGame();
    await tracker.poll();
    // TrackIR is closed, as Stand down does for this setup.
    expect(app.ports.processes.closed.map((c) => c.name)).toEqual(['TrackIR5.exe']);
    const phases = states.slice(-2);
    expect(phases[0]).toMatchObject({ phase: 'ended', standingDown: true });
    expect(phases[1]).toMatchObject({
      phase: 'ended',
      durationSeconds: 1800,
      stoodDown: { headline: 'Closed 1 app', failed: 0 },
    });
    expect(phases[1]!.standingDown).toBeUndefined();
    expect(notified()).toEqual([
      { title: 'Welcome back', body: 'DCS F/A-18C: 30 min. Stood down: Closed 1 app.' },
    ]);
    // Read and dismissed.
    expect(tracker.dismiss()).toEqual({ phase: 'idle' });
  });

  it('a Stand down that fails by itself says so instead of "stood down"', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { fly, tracker, states } = make();
    await fly.setPreferences({ autoStandDown: true });
    await fly.launch(P);
    await closeGame();
    // The setup file is gone by the time the game closes.
    await fs.rm(app.wiring.context.profiles.fileFor(P));
    await tracker.poll();
    expect(states.at(-1)).toMatchObject({ phase: 'ended', stoodDown: { failed: 1 } });
    expect(states.at(-1)!.stoodDown!.headline).toMatch(/^Stand down did not finish: /);
    expect(notified()[0]!.body).toMatch(/less than a minute\. Stand down did not finish: /);
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
