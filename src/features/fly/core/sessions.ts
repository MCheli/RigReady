import path from 'node:path';
import { z } from 'zod';
import type {
  ActionReport,
  CheckResult,
  ChecklistReport,
  StepResult,
} from '../../../core/checks/engine';
import type { MainContext } from '../../../core/feature';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore } from '../../../core/ports';
import type { CheckGroup } from '../../../core/profile/schema';
import { standDownWaitText, type StandDownOnClose } from '../../../core/profile/standDownOnClose';
import { err, ok, type Result } from '../../../core/result';
import {
  SessionRecordSchema,
  type History,
  type SessionRecord,
  type SessionState,
} from '../contract';
import type { Sleep } from './actions';
import {
  durationText,
  stoodDownLine,
  totalsLine,
  type FixTotal,
  type LastSession,
  type SessionTotals,
} from './sessionText';

/**
 * Sessions: what happens between Launch and the game closing, and the record of it.
 *
 * SessionLog is the file (<data root>/fly/sessions.json). SessionTracker follows one
 * session: it is told about checks, fixes and the launch by Fly, looks at the process list
 * while the game runs, and when the game is gone says "welcome back", writes the record,
 * and, when the setup says so, counts down and then stands down by itself.
 *
 * Stand down by itself: the cases, and what was decided for each.
 *
 * - The setup decides. It has a switch (on unless the setup says no) and a countdown
 *   length (one minute unless it says otherwise). A setup saved before this existed says
 *   nothing and gets both defaults.
 * - The countdown is what the user sees and can cancel. RigReady's window is brought
 *   back from the tray when it starts, and Windows says so too when nobody is at a window.
 * - Cancel, Dismiss, pressing Play again and the game coming back each end the countdown.
 *   Nothing is closed in any of these cases, and nothing says it was. Play, Make ready and
 *   a fix end it the moment they are pressed, before they start anything: a launch can take
 *   longer than what is left of the countdown, and Stand down would then close, in the
 *   middle of the launch, the apps the launch had just started. A check does not end it:
 *   the Play screen checks again every few seconds by itself, and a check changes nothing.
 * - A game that closes within two minutes of starting (QUICK_EXIT_MS) starts no
 *   countdown. It may have crashed, been started by mistake, or be a launcher handing
 *   over to the real game, and standing down under a game that is about to run would
 *   close the helper apps it needs. "Welcome back" says why; Stand down is one press away.
 * - A launcher that exits while the real game runs: every program name the game is known
 *   by is watched, so the session ends only when the last of them is gone. For a gap
 *   between the two, and for a restart, RigReady keeps looking after the game closed: for
 *   as long as a countdown runs, and for LOOK_BACK_MS at least. The game running again
 *   ends the countdown and is a new session. What cannot be told apart from a game that
 *   closed is a game RigReady does not know, started by a launcher of another name that
 *   stayed open for more than two minutes. The countdown on the screen, its notification
 *   and the setup's own switch are what is left for that one.
 * - Stand down pressed by hand during the countdown ends the countdown the moment it
 *   starts, so two never run at once. The one that was pressed reports as it always does.
 * - Stand down pressed by hand while the game runs, with "close the game": the game
 *   closes while that Stand down is still running. No countdown starts under it: the one
 *   that was pressed is this session's Stand down, so the window is not brought up and
 *   Windows is not told about another. The same when the user closes the game while a
 *   Stand down pressed by hand runs.
 * - RigReady quit during the countdown: the countdown ends with the app. Nothing is stood
 *   down then or at the next start, and nothing says it was. (A window closed to the tray
 *   is not a quit: the countdown carries on.)
 * - The list of running programs cannot be read when the time is up: Stand down waits
 *   for a look that works, because it must not run while the game may be back.
 * - A Stand down that ran says which steps did not work; one that could not run says why.
 */

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The session in progress, as it is kept on disk so it survives a restart of RigReady. */
const CurrentSchema = SessionRecordSchema.extend({
  /** Image names that mean the game is running. */
  processes: z.array(z.string()),
});
type Current = z.infer<typeof CurrentSchema>;

const SessionFileSchema = z.object({
  current: CurrentSchema.optional(),
  /** Oldest first. */
  sessions: z.array(SessionRecordSchema).default([]),
});
type SessionFile = z.infer<typeof SessionFileSchema>;

/** The newest sessions kept; older ones drop off the end. */
export const MAX_SESSIONS = 1000;
/** How many sessions the History view lists (the totals cover every session kept). */
export const HISTORY_LISTED = 100;
/** sessions.json, then sessions.1.json ... when an earlier file is damaged. */
const GENERATIONS = 5;

const DAMAGED = new Set(['store.invalid', 'file.tooLarge']);
/** A window that has not said it is in use for this long is taken to be gone. */
export const PRESENCE_MS = 60_000;
/** Away from RigReady's window for this long, coming back counts as opening it again. */
export const AWAY_MS = 2 * 60_000;
/** A game that closed sooner than this after it started does not start the countdown. */
export const QUICK_EXIT_MS = 2 * 60_000;
/** How long RigReady keeps looking for a game that closed to come back, at least. */
export const LOOK_BACK_MS = 15 * 60_000;
/** How long the countdown waits to hear what its Stand down will need a person for. */
export const NEEDS_YOU_MS = 3000;

/** What the history adds up to. */
export function sessionTotals(sessions: SessionRecord[]): SessionTotals {
  const fixes = new Map<string, FixTotal>();
  for (const session of sessions) {
    for (const fix of session.fixed) {
      const key = `${fix.group}:${fix.title.toLowerCase()}`;
      const known = fixes.get(key);
      if (known) known.count++;
      else fixes.set(key, { title: fix.title, group: fix.group, count: 1 });
    }
  }
  const waits = sessions
    .map((s) => s.readySeconds)
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => a - b);
  const middle = waits.length > 0 ? waits[Math.floor((waits.length - 1) / 2)] : undefined;
  return {
    sessions: sessions.length,
    seconds: sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
    fixes: [...fixes.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
    ...(middle !== undefined ? { readySeconds: middle } : {}),
    notReady: sessions.filter((s) => s.notReady).length,
  };
}

export class SessionLog {
  constructor(
    private readonly files: FileStore,
    private readonly dir: string
  ) {}

  private store(generation: number): JsonStore<typeof SessionFileSchema> {
    const name = generation === 0 ? 'sessions.json' : `sessions.${generation}.json`;
    return new JsonStore(this.files, path.join(this.dir, name), SessionFileSchema);
  }

  /**
   * The file in use: the first that reads. A damaged one is left exactly as it is, named,
   * and the next takes over, so a broken file neither ends the history nor gets replaced.
   */
  private async open(): Promise<
    Result<{ store: JsonStore<typeof SessionFileSchema>; value: SessionFile; damaged: string[] }>
  > {
    const damaged: string[] = [];
    for (let generation = 0; generation < GENERATIONS; generation++) {
      const store = this.store(generation);
      const value = await store.read();
      if (value.ok) return ok({ store, value: value.value, damaged });
      if (!DAMAGED.has(value.error.code)) return value;
      damaged.push(path.basename(store.file));
    }
    return err(
      'fly.history',
      'The session history cannot be read.',
      `${damaged.join(', ')} in ${this.dir} are damaged and were left as they are.`
    );
  }

  /** The changes still to run: one starts only when the one before it has written. */
  private pending: Promise<unknown> = Promise.resolve();

  /**
   * Reads, applies, writes. Changes run one after another: two made at once (a game closing
   * as the next one is launched) would both read the same history, and the second write
   * would undo the first.
   */
  private change(apply: (file: SessionFile) => SessionFile): Promise<Result<SessionFile>> {
    const run = this.pending.then(async () => {
      const opened = await this.open();
      if (!opened.ok) return opened;
      return opened.value.store.write(apply(opened.value.value));
    });
    // A change that throws fails by itself; the next one still runs.
    this.pending = run.catch(() => undefined);
    return run;
  }

  async current(): Promise<Result<Current | undefined>> {
    const opened = await this.open();
    return opened.ok ? ok(opened.value.value.current) : opened;
  }

  /** Remembers the session in progress, or that there is none. */
  setCurrent(current: Current | undefined): Promise<Result<SessionFile>> {
    return this.change((file) => ({ sessions: file.sessions, ...(current ? { current } : {}) }));
  }

  /** Adds a finished session; it is no longer the one in progress. */
  finish(record: SessionRecord): Promise<Result<SessionFile>> {
    return this.change((file) => ({
      sessions: [...file.sessions, record].slice(-MAX_SESSIONS),
    }));
  }

  /** The last session of every setup that has one. */
  async lastByProfile(): Promise<Record<string, LastSession>> {
    const opened = await this.open();
    const last: Record<string, LastSession> = {};
    if (!opened.ok) return last;
    for (const session of opened.value.value.sessions) {
      last[session.profileId] = {
        startedAt: session.startedAt,
        ...(session.durationSeconds !== undefined
          ? { durationSeconds: session.durationSeconds }
          : {}),
      };
    }
    return last;
  }

  /** Newest first, with what it adds up to. Never fails: a history that cannot be read says so. */
  async history(): Promise<History> {
    const opened = await this.open();
    if (!opened.ok) {
      const totals = sessionTotals([]);
      return {
        sessions: [],
        totals,
        line: totalsLine(totals),
        notice: opened.error.detail
          ? `${opened.error.message} ${opened.error.detail}`
          : opened.error.message,
      };
    }
    const { value, damaged, store } = opened.value;
    const totals = sessionTotals(value.sessions);
    return {
      sessions: [...value.sessions].reverse().slice(0, HISTORY_LISTED),
      totals,
      line: totalsLine(totals),
      ...(damaged.length > 0
        ? {
            notice: `${damaged.join(', ')} could not be read and ${damaged.length === 1 ? 'was' : 'were'} left as ${damaged.length === 1 ? 'it is' : 'they are'}; the history continues in ${path.basename(store.file)}.`,
          }
        : {}),
    };
  }
}

/** A setup, as much of it as a session needs. */
export interface SessionSetup {
  id: string;
  name: string;
}

export interface TrackerDeps {
  /** Tells every window what the session is now. */
  emit(state: SessionState): void;
  /**
   * Stand down for a setup, the same one the button runs. Run when the countdown is over.
   * `problems` are the steps that did not work, each in its own words.
   */
  standDown(
    profileId: string
  ): Promise<Result<{ headline: string; failed: number; problems: string[] }>>;
  /** What the setup says about standing down by itself when its game closes. */
  standDownOnClose(profileId: string): Promise<StandDownOnClose>;
  /**
   * What that Stand down will need a person at the screens for, one line each: said with
   * the countdown, so whoever is there knows to stay. Changes nothing.
   */
  standDownNeedsYou?(profileId: string): Promise<string[]>;
  /** Brings RigReady's window where it can be seen: a countdown nobody sees cannot be cancelled. */
  showWindow(): Promise<void>;
}

export interface TrackerOptions {
  /** Waits between two looks at the process list. */
  sleep?: Sleep;
  pollMs?: number;
  /** How long a game handed to Steam may take to show up before RigReady stops waiting for it. */
  startGraceMs?: number;
  /** QUICK_EXIT_MS unless a test says otherwise. */
  quickExitMs?: number;
  /** LOOK_BACK_MS unless a test says otherwise. */
  lookBackMs?: number;
  /** NEEDS_YOU_MS unless a test says otherwise. */
  needsYouMs?: number;
}

interface Fixed {
  itemId: string;
  title: string;
  group: CheckGroup;
  message: string;
}

/** What happened between opening a setup and launching it. */
interface Preparation {
  profileId: string;
  openedAt: number;
  readyAt?: number;
  ready: boolean;
  failedFirst?: { title: string; summary: string };
  fixed: Fixed[];
}

interface Live {
  record: Current;
  /** The game's own program has been seen running. */
  seen: boolean;
  /** When the launch was asked for (a game handed to Steam shows up later). */
  askedAt: number;
  /** The user stood down while the game ran: when it ends there is nothing left to offer. */
  stoodDown: boolean;
}

/** The session that closed, for as long as RigReady still looks for its game to come back. */
interface After {
  profileId: string;
  profileName: string;
  gameName: string | undefined;
  /** "Welcome back" as it is without anything about Stand down. */
  ended: SessionState;
  /** Image names that mean the game is running again. */
  processes: string[];
  /** When the game closed. */
  endedAt: number;
  /** When Stand down runs by itself; undefined when it is not going to. */
  standDownAt: number | undefined;
  /** The start of what Windows and the screen say about this session: "DCS F/A-18C: 42 min." */
  said: string;
}

type Ctx = Pick<MainContext, 'ports' | 'log'>;

/** A wait that never keeps the process alive. */
const quietSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });

export class SessionTracker {
  private state: SessionState = { phase: 'idle' };
  private prep: Preparation | undefined;
  private live: Live | undefined;
  /** Set from the moment the game closed until RigReady stops looking for it to come back. */
  private after: After | undefined;
  /** Each session's watch loop has a number; a loop whose number is old stops. */
  private token = 0;
  /** What each window of RigReady last said about being in use, when, and since when that is so. */
  private readonly windows = new Map<string, { visible: boolean; at: number; since: number }>();
  private resumed: Promise<void> | undefined;
  /** The Stand down after the countdown is running. */
  private standingDown = false;
  /** A Stand down started by hand is running (see standDownStarted and standDownEnded). */
  private byHand = false;
  private readonly sleep: Sleep;
  private readonly pollMs: number;
  private readonly startGraceMs: number;
  private readonly quickExitMs: number;
  private readonly lookBackMs: number;
  private readonly needsYouMs: number;

  constructor(
    private readonly ctx: Ctx,
    private readonly log: SessionLog,
    private readonly deps: TrackerDeps,
    options: TrackerOptions = {}
  ) {
    this.sleep = options.sleep ?? quietSleep;
    this.pollMs = options.pollMs ?? 2000;
    this.startGraceMs = options.startGraceMs ?? 15 * 60_000;
    this.quickExitMs = options.quickExitMs ?? QUICK_EXIT_MS;
    this.lookBackMs = options.lookBackMs ?? LOOK_BACK_MS;
    this.needsYouMs = options.needsYouMs ?? NEEDS_YOU_MS;
  }

  private now(): Date {
    return this.ctx.ports.clock.now();
  }

  private set(state: SessionState): void {
    this.state = state;
    this.deps.emit(state);
  }

  /**
   * The session as it is now. The first call also picks up a session that was in progress
   * when RigReady was last closed.
   */
  async current(): Promise<SessionState> {
    await (this.resumed ??= this.resume());
    return this.state;
  }

  // ---- before the launch: how the rig got ready ----

  /** A checklist run ended. The first one after opening a setup starts the clock. */
  checked(profile: SessionSetup, report: ChecklistReport, startedAt: Date): void {
    if (this.prep?.profileId !== profile.id) {
      const first = report.results.find(
        (r) => r.required && !r.disabled && (r.status === 'fail' || r.status === 'error')
      );
      this.prep = {
        profileId: profile.id,
        openedAt: startedAt.getTime(),
        ready: report.ready,
        fixed: [],
        ...(first ? { failedFirst: { title: first.title, summary: first.summary } } : {}),
      };
    }
    this.prep.ready = report.ready;
    if (report.ready && this.prep.readyAt === undefined) this.prep.readyAt = this.now().getTime();
  }

  private noteFix(profile: SessionSetup, step: StepResult, group: CheckGroup): void {
    if (!step.ok || step.skipped || this.prep?.profileId !== profile.id) return;
    if (this.prep.fixed.some((f) => f.itemId === step.itemId)) return;
    this.prep.fixed.push({ itemId: step.itemId, title: step.title, group, message: step.message });
  }

  /** One item's fix button was used. */
  fixed(profile: SessionSetup, step: StepResult, result: CheckResult): void {
    this.noteFix(profile, step, result.group);
  }

  /** Make ready ran: what it fixed, and whether the rig is ready now. */
  madeReady(profile: SessionSetup, action: ActionReport): void {
    const groups = new Map(action.report.results.map((r) => [r.itemId, r.group]));
    for (const step of action.steps)
      this.noteFix(profile, step, groups.get(step.itemId) ?? 'other');
    this.checked(profile, action.report, this.now());
  }

  // ---- the session ----

  /**
   * The game was launched. `processes` are the image names that mean it is running (none:
   * RigReady cannot tell when this game closes); `seen` says the launch itself saw the
   * game's own program, which a hand-off to Steam does not.
   */
  async launched(
    profile: SessionSetup,
    game: { name?: string | undefined; processes: string[]; seen: boolean }
  ): Promise<void> {
    await (this.resumed ??= this.resume());
    const running = this.live;
    // Launch pressed again while the game runs: it is still the same session.
    if (running && running.record.profileId === profile.id && running.seen) return;
    // Play pressed after a game closed: its countdown is over, and this is a new session.
    this.after = undefined;
    const now = this.now();
    if (running?.seen) {
      // Another setup's game was still being watched: its session ends where this one starts.
      const { processes: _watched, ...earlier } = running.record;
      const seconds = Math.max(
        0,
        Math.round((now.getTime() - Date.parse(earlier.startedAt)) / 1000)
      );
      this.report(await this.log.finish({ ...earlier, durationSeconds: seconds }));
    }
    const prep = this.prep?.profileId === profile.id ? this.prep : undefined;
    this.prep = undefined;
    const record: Current = {
      id: `${now.toISOString()}-${profile.id}`,
      profileId: profile.id,
      profileName: profile.name,
      ...(game.name ? { gameName: game.name } : {}),
      startedAt: now.toISOString(),
      ...(prep?.readyAt !== undefined
        ? { readySeconds: Math.max(0, Math.round((prep.readyAt - prep.openedAt) / 1000)) }
        : {}),
      fixed: (prep?.fixed ?? []).map(({ title, group, message }) => ({ title, group, message })),
      ...(prep?.failedFirst ? { failedFirst: prep.failedFirst } : {}),
      ...(prep && !prep.ready ? { notReady: true } : {}),
      processes: game.processes,
    };
    this.token++;
    if (game.processes.length === 0) {
      // Nothing to watch for: the launch is recorded, its length is not known.
      this.live = undefined;
      const { processes: _none, ...rest } = record;
      this.report(await this.log.finish(rest));
      if (this.state.phase !== 'idle') this.set({ phase: 'idle' });
      return;
    }
    this.live = { record, seen: game.seen, askedAt: now.getTime(), stoodDown: false };
    this.report(await this.log.setCurrent(record));
    this.set(this.liveState());
    void this.watch(this.token);
  }

  private liveState(): SessionState {
    const live = this.live;
    if (!live) return { phase: 'idle' };
    const { record } = live;
    return {
      phase: live.seen ? 'running' : 'starting',
      profileId: record.profileId,
      profileName: record.profileName,
      ...(record.gameName ? { gameName: record.gameName } : {}),
      startedAt: record.startedAt,
    };
  }

  private report(result: Result<unknown>): void {
    if (!result.ok) this.ctx.log.warn('the session history could not be written', result.error);
  }

  private async watch(token: number): Promise<void> {
    while (token === this.token && this.live) {
      await this.sleep(this.pollMs);
      if (token !== this.token) return;
      await this.poll();
    }
  }

  /** One look at the process list. The watch loops call it; exposed for tests. */
  async poll(): Promise<void> {
    if (this.after) return this.pollAfter(this.after);
    const live = this.live;
    const token = this.token;
    if (!live) return;
    const list = await this.ctx.ports.processes.list();
    if (token !== this.token) return;
    // The list cannot be read right now: that is neither a start nor an end.
    if (!list.ok) return;
    const running = live.record.processes.some((name) =>
      list.value.some((p) => sameName(p.name, name))
    );
    const now = this.now();
    if (!live.seen) {
      if (running) {
        live.seen = true;
        // The session is the game running, not the wait for Steam.
        live.record.startedAt = now.toISOString();
        this.report(await this.log.setCurrent(live.record));
        this.set(this.liveState());
      } else if (now.getTime() - live.askedAt >= this.startGraceMs) {
        // Steam never started it (an update, a sign-in, a closed window): nothing was flown.
        this.token++;
        this.live = undefined;
        this.report(await this.log.setCurrent(undefined));
        this.set({ phase: 'idle' });
      }
      return;
    }
    if (running) return;
    await this.end(live, now);
  }

  private async end(live: Live, now: Date): Promise<void> {
    const token = ++this.token;
    // Taken now: a Stand down by hand that ends while the record is written still counts.
    const handled = live.stoodDown || this.byHand;
    this.live = undefined;
    this.prep = undefined;
    const { processes, ...rest } = live.record;
    const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(rest.startedAt)) / 1000));
    this.report(await this.log.finish({ ...rest, durationSeconds: seconds }));
    // Play was pressed meanwhile: that session has its own state.
    if (token !== this.token) return;
    if (handled) {
      // Stand down already ran while the game was open, or one pressed by hand is running
      // now (it may be what closed the game): there is nothing left to offer.
      this.set({ phase: 'idle' });
      return;
    }
    const ended: SessionState = {
      phase: 'ended',
      profileId: rest.profileId,
      profileName: rest.profileName,
      ...(rest.gameName ? { gameName: rest.gameName } : {}),
      startedAt: rest.startedAt,
      endedAt: now.toISOString(),
      durationSeconds: seconds,
    };
    const said = `${rest.profileName}: ${durationText(seconds)}.`;
    const wish = await this.deps.standDownOnClose(rest.profileId);
    if (token !== this.token) return;
    // What that Stand down will need someone at the screens for, said with its countdown.
    const counts = wish.enabled && seconds * 1000 >= this.quickExitMs;
    const needsYou = counts ? await this.needsYou(rest.profileId) : [];
    if (token !== this.token) return;
    const after: After = {
      profileId: rest.profileId,
      profileName: rest.profileName,
      gameName: rest.gameName,
      ended,
      processes,
      endedAt: now.getTime(),
      standDownAt: undefined,
      said,
    };
    this.after = after;
    // Whatever is decided below, RigReady goes on looking for the game to come back.
    void this.watchAfter(token);
    if (!wish.enabled) {
      // This setup says no: Stand down is the user's to press.
      this.set(ended);
      await this.notifyWhenAway(`${said} Stand down when you are done.`);
      return;
    }
    if (seconds * 1000 < this.quickExitMs) {
      // Too short to have been a session (see the top of this file): nothing counts down.
      this.set({ ...ended, standDownHeld: 'quickExit' });
      await this.notifyWhenAway(`${said} Stand down when you are done.`);
      return;
    }
    // The countdown runs from the moment it is on the screen.
    after.standDownAt = this.now().getTime() + wish.seconds * 1000;
    this.set({
      ...ended,
      standDownAt: new Date(after.standDownAt).toISOString(),
      standDownSeconds: wish.seconds,
      ...(needsYou.length > 0 ? { standDownNeedsYou: needsYou } : {}),
    });
    // Windows says it when nobody was at a window, and then the window comes to them.
    await this.notifyWhenAway(
      [
        `${said} Stand down starts in ${standDownWaitText(wish.seconds)}. Open RigReady to cancel.`,
        ...needsYou,
      ].join(' ')
    );
    await this.deps.showWindow();
  }

  /**
   * What the Stand down after the countdown will need a person for. Never holds the
   * countdown up for long: a step that cannot say in time (a monitor read that hangs) is
   * left unsaid, and the countdown starts without it.
   */
  private async needsYou(profileId: string): Promise<string[]> {
    const ask = this.deps.standDownNeedsYou;
    if (!ask) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), this.needsYouMs);
      (timer as { unref?: () => void }).unref?.();
    });
    try {
      const lines = await Promise.race([ask(profileId), late]);
      if (lines !== undefined) return lines;
      this.ctx.log.warn(
        'what Stand down will need was not known in time; the countdown said nothing about it'
      );
      return [];
    } catch (thrown) {
      this.ctx.log.warn('what Stand down will need could not be worked out', thrown);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Looks for the game to come back, and at the clock while a countdown runs. */
  private async watchAfter(token: number): Promise<void> {
    while (token === this.token && this.after) {
      const due = this.after.standDownAt;
      const left = due === undefined ? this.pollMs : due - this.now().getTime();
      // Not later than the end of the countdown, and never in a tight loop.
      await this.sleep(Math.min(this.pollMs, Math.max(left, 200)));
      if (token !== this.token) return;
      await this.poll();
    }
  }

  /** One look after the game closed: is it back, and is it time to stand down? */
  private async pollAfter(after: After): Promise<void> {
    const token = this.token;
    const list = await this.ctx.ports.processes.list();
    if (token !== this.token || this.after !== after) return;
    // The list cannot be read right now: whether the game is back is not known, so
    // nothing is done, and a countdown that is over waits for a look that works.
    if (!list.ok) return;
    const now = this.now();
    if (after.processes.some((name) => list.value.some((p) => sameName(p.name, name)))) {
      await this.returned(after, now);
      return;
    }
    if (after.standDownAt !== undefined) {
      if (now.getTime() >= after.standDownAt) await this.standDownNow(after);
      return;
    }
    // Nothing is counting down and the game stayed away: it is over.
    if (now.getTime() - after.endedAt >= this.lookBackMs) this.after = undefined;
  }

  /**
   * The game is running again after it closed: it was restarted, or a launcher handed over
   * to it. A countdown that was running is over, and this is a new session of the same
   * setup. The one before it is in the history already, with its own length.
   */
  private async returned(after: After, now: Date): Promise<void> {
    this.after = undefined;
    const token = ++this.token;
    const record: Current = {
      id: `${now.toISOString()}-${after.profileId}`,
      profileId: after.profileId,
      profileName: after.profileName,
      ...(after.gameName ? { gameName: after.gameName } : {}),
      startedAt: now.toISOString(),
      fixed: [],
      processes: after.processes,
    };
    this.live = { record, seen: true, askedAt: now.getTime(), stoodDown: false };
    this.report(await this.log.setCurrent(record));
    if (token !== this.token) return;
    this.set(this.liveState());
    void this.watch(token);
  }

  /** The countdown is over and the game stayed closed: the same Stand down the button runs. */
  private async standDownNow(after: After): Promise<void> {
    // From here on nothing is looked for: what starts now is not this session's business.
    this.after = undefined;
    const token = this.token;
    this.set({ ...after.ended, standingDown: true });
    this.standingDown = true;
    let down: Result<{ headline: string; failed: number; problems: string[] }>;
    try {
      down = await this.deps.standDown(after.profileId);
    } catch (thrown) {
      // Said on the screen like any other Stand down that did not finish.
      down = err('fly.standDown', thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      this.standingDown = false;
    }
    // A new launch meanwhile has its own state: this one's is history.
    if (token !== this.token) return;
    const stoodDown = down.ok
      ? { finished: true, ...down.value }
      : {
          finished: false,
          headline: 'Stand down did not finish',
          failed: 1,
          problems: [down.error.message],
        };
    this.set({ ...after.ended, stoodDown });
    const line = stoodDownLine(stoodDown);
    await this.notifyWhenAway(`${after.said} ${line}${/[.!?]$/.test(line) ? '' : '.'}`);
  }

  /** True while somebody is at a window of RigReady (it said so within the last minute). */
  private attended(): boolean {
    const now = this.now().getTime();
    return [...this.windows.values()].some(
      (window) => window.visible && now - window.at < PRESENCE_MS
    );
  }

  /** With nobody at a window of RigReady, Windows says it instead. */
  private async notifyWhenAway(body: string): Promise<void> {
    if (this.attended()) return;
    const sent = await this.ctx.ports.notifications.notify({ title: 'Welcome back', body });
    if (!sent.ok) this.ctx.log.warn('the welcome-back notification could not be shown', sent.error);
  }

  /**
   * Stand down was started by hand (on the screen, from the tray, by an assistant). A
   * countdown that was running is over from this moment: the Stand down that was asked
   * for is the one that runs, and no second one starts on top of it.
   */
  standDownStarted(): void {
    // The countdown's own Stand down says this too; that one is already accounted for.
    if (this.standingDown) return;
    // Until it ends, the game closing (by this Stand down or by the user) starts nothing.
    this.byHand = true;
    const after = this.after;
    if (after?.standDownAt === undefined) return;
    after.standDownAt = undefined;
    this.set(after.ended);
  }

  /** The Stand down started by hand is over, whatever came of it. */
  standDownEnded(): void {
    if (this.standingDown) return;
    this.byHand = false;
  }

  /**
   * Play, Make ready or a fix was pressed: the rig is being made ready again. A countdown
   * that was running is over before anything is started, and until the game is up the
   * screen says it was cancelled. Nothing is closed, and nothing says it was. RigReady
   * still looks for the game to come back, as after Cancel.
   */
  gettingReady(): void {
    const after = this.after;
    if (after?.standDownAt === undefined) return;
    after.standDownAt = undefined;
    this.set({ ...after.ended, standDownHeld: 'cancelled' });
  }

  /** Stand down ran (by the user, on the screen or from the tray). */
  stoodDown(): void {
    if (this.standingDown) return;
    this.prep = undefined;
    if (this.live) this.live.stoodDown = true;
    else if (this.state.phase === 'ended') {
      this.after = undefined;
      this.set({ phase: 'idle' });
    }
  }

  /**
   * Cancel on the countdown: Stand down does not run by itself this time. Nothing is
   * closed, "Welcome back" stays, and Stand down is still the user's to press. A Stand
   * down that has already started carries on: the answer says so, and so does the screen.
   */
  cancelStandDown(): SessionState {
    const after = this.after;
    if (after?.standDownAt !== undefined) {
      after.standDownAt = undefined;
      this.set({ ...after.ended, standDownHeld: 'cancelled' });
    }
    return this.state;
  }

  /**
   * "Welcome back" was read: the screen goes back to normal without standing down. A
   * countdown that was running ends with it.
   */
  dismiss(): SessionState {
    if (this.state.phase === 'ended' && !this.state.standingDown) {
      this.after = undefined;
      this.set({ phase: 'idle' });
    }
    return this.state;
  }

  /**
   * A window of RigReady says whether somebody is at it: true when the user does something
   * in it, false when it is hidden. A window in use says so again every few seconds; one
   * that is left alone or closed just stops, and counts as unattended after a minute.
   */
  presence(window: string, visible: boolean): { attended: boolean } {
    const now = this.now().getTime();
    const before = this.windows.get(window);
    const since = before && before.visible === visible ? before.since : now;
    this.windows.set(window, { visible, at: now, since });
    // Coming back after a while is a new opening: the time to ready counts from here. A
    // moment in another window is not.
    if (before && !before.visible && visible && now - before.since >= AWAY_MS) {
      this.prep = undefined;
    }
    return { attended: this.attended() };
  }

  /**
   * RigReady's main window got out of the way after a launch: nobody is at it until it
   * says otherwise, whatever was done in it a moment ago.
   */
  hidden(): void {
    this.presence('main', false);
  }

  private async resume(): Promise<void> {
    const kept = await this.log.current();
    if (!kept.ok || !kept.value || this.live) return;
    const list = await this.ctx.ports.processes.list();
    if (!list.ok || this.live) return;
    const record = kept.value;
    const running = record.processes.some((name) => list.value.some((p) => sameName(p.name, name)));
    if (running) {
      this.live = { record, seen: true, askedAt: Date.parse(record.startedAt), stoodDown: false };
      this.state = this.liveState();
      void this.watch(++this.token);
      return;
    }
    // It ended while RigReady was closed: that it happened is known, how long it was is not.
    const { processes: _watched, ...rest } = record;
    this.report(await this.log.finish(rest));
  }

  /**
   * Stops watching (the app is quitting). The session in progress stays on disk for the
   * next start. A countdown ends here: nothing is stood down after this, now or at the
   * next start, and nothing says it was.
   */
  stop(): void {
    this.token++;
    this.after = undefined;
  }
}
