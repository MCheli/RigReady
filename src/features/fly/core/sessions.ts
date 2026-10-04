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
 * and stands down by itself when the user asked for that.
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

  private async change(apply: (file: SessionFile) => SessionFile): Promise<Result<SessionFile>> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    return opened.value.store.write(apply(opened.value.value));
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
  /** Stand down for a setup; run when the user asked for it to happen by itself. */
  standDown(profileId: string): Promise<Result<{ headline: string; failed: number }>>;
  /** Whether the user asked for that. */
  autoStandDown(): Promise<boolean>;
}

export interface TrackerOptions {
  /** Waits between two looks at the process list. */
  sleep?: Sleep;
  pollMs?: number;
  /** How long a game handed to Steam may take to show up before RigReady stops waiting for it. */
  startGraceMs?: number;
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
  /** Each session's watch loop has a number; a loop whose number is old stops. */
  private token = 0;
  /** What each window of RigReady last said about being in use, when, and since when that is so. */
  private readonly windows = new Map<string, { visible: boolean; at: number; since: number }>();
  private resumed: Promise<void> | undefined;
  private standingDown = false;
  private readonly sleep: Sleep;
  private readonly pollMs: number;
  private readonly startGraceMs: number;

  constructor(
    private readonly ctx: Ctx,
    private readonly log: SessionLog,
    private readonly deps: TrackerDeps,
    options: TrackerOptions = {}
  ) {
    this.sleep = options.sleep ?? quietSleep;
    this.pollMs = options.pollMs ?? 2000;
    this.startGraceMs = options.startGraceMs ?? 15 * 60_000;
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

  /** One look at the process list. The watch loop calls it; exposed for tests. */
  async poll(): Promise<void> {
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
    this.token++;
    this.live = undefined;
    this.prep = undefined;
    const { processes: _watched, ...rest } = live.record;
    const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(rest.startedAt)) / 1000));
    this.report(await this.log.finish({ ...rest, durationSeconds: seconds }));
    if (live.stoodDown) {
      // Stand down already ran while the game was open: there is nothing left to offer.
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
    if (!(await this.deps.autoStandDown())) {
      this.set(ended);
      await this.notifyWhenAway(`${said} Stand down when you are done.`);
      return;
    }
    this.set({ ...ended, standingDown: true });
    this.standingDown = true;
    let down: Result<{ headline: string; failed: number }>;
    try {
      down = await this.deps.standDown(rest.profileId);
    } finally {
      this.standingDown = false;
    }
    // A new launch meanwhile has its own state: this one's is history.
    if (this.state.phase !== 'ended' || this.state.endedAt !== ended.endedAt) return;
    const stoodDown = down.ok
      ? down.value
      : { headline: `Stand down did not finish: ${down.error.message}`, failed: 1 };
    this.set({ ...ended, stoodDown });
    await this.notifyWhenAway(
      down.ok ? `${said} Stood down: ${stoodDown.headline}.` : `${said} ${stoodDown.headline}`
    );
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

  /** Stand down ran (by the user, on the screen or from the tray). */
  stoodDown(): void {
    if (this.standingDown) return;
    this.prep = undefined;
    if (this.live) this.live.stoodDown = true;
    else if (this.state.phase === 'ended') this.set({ phase: 'idle' });
  }

  /** "Welcome back" was read: the screen goes back to normal without standing down. */
  dismiss(): SessionState {
    if (this.state.phase === 'ended' && !this.state.standingDown) this.set({ phase: 'idle' });
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

  /** Stops watching (the app is quitting). The session in progress stays on disk for the next start. */
  stop(): void {
    this.token++;
  }
}
