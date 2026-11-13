import type { CheckGroup } from '../../../core/profile/schema';
import { standDownWaitText } from '../../../core/profile/standDownOnClose';

/**
 * The words for a session: how long it was, when it was, what the history adds up to, and
 * what Stand down by itself is doing. Pure and free of Node, so the screen and the
 * notification say the same thing.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 h 42 min", "42 min", "less than a minute". */
export function durationText(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'less than a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A total over many sessions: to the minute at first ("1 h 42 min"), in whole hours from ten on ("14 h"). */
export function totalText(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 600) return durationText(minutes * 60);
  return `${Math.round(minutes / 60)} h`;
}

/** A running clock: "0:42:17". */
export function elapsedText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${Math.floor(whole / 3600)}:${two(Math.floor((whole % 3600) / 60))}:${two(whole % 60)}`;
}

/** A short wait: "8 s", "1 min 20 s", "12 min". */
export function waitText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes >= 10 || rest === 0) return `${minutes} min`;
  return `${minutes} min ${rest} s`;
}

/** Midnight at the start of a date's day, on this PC's clock. */
const dayStart = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When something happened, as you would say it: "today", "yesterday", the weekday within
 * the last week, then the date ("3 Oct", with the year when it is not this one). Days are
 * the days of this PC's clock.
 */
export function whenText(at: Date, now: Date): string {
  // Rounded: a day is 23 or 25 hours long when the clocks change.
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return DAYS[at.getDay()]!;
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`;
}

/** The hour and minute on this PC's clock: "20:14". */
export function clockText(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

export interface LastSession {
  startedAt: string;
  /** Absent when RigReady could not tell how long it was. */
  durationSeconds?: number | undefined;
}

/**
 * The one line of context under a setup's name: "Last session Tuesday, 1 h 42 min". The
 * same words whatever the game is: someone who only races reads it as naturally as a pilot.
 */
export function lastSessionLine(last: LastSession | undefined, now: Date): string {
  if (!last) return 'No session yet';
  const when = whenText(new Date(last.startedAt), now);
  return last.durationSeconds === undefined
    ? `Last session ${when}`
    : `Last session ${when}, ${durationText(last.durationSeconds)}`;
}

/** What a fix of this kind did, for "TrackIR needed starting 6 times". */
const FIX_VERB: Record<CheckGroup, string> = {
  displays: 'applying',
  audio: 'setting',
  files: 'restoring',
  devices: 'fixing',
  apps: 'starting',
  other: 'running',
};

export function timesText(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}

export interface FixTotal {
  title: string;
  group: CheckGroup;
  count: number;
}

export function fixTotalText(fix: FixTotal): string {
  return `${fix.title} needed ${FIX_VERB[fix.group]} ${timesText(fix.count)}`;
}

export interface SessionTotals {
  /** Sessions recorded. */
  sessions: number;
  /** Seconds in the sessions whose length is known. */
  seconds: number;
  /** What had to be fixed before launching, most often first. */
  fixes: FixTotal[];
  /** The usual time from opening RigReady to a ready rig (the median), when any was measured. */
  readySeconds?: number | undefined;
  /** Sessions launched with something required not met. */
  notReady: number;
}

// ---- Stand down by itself, after the game closed ----

/** What a Stand down that ran by itself did. */
export interface StoodDown {
  /** False when it could not run, or stopped before its end. */
  finished: boolean;
  /** "Closed 2 apps", as the Stand down button reports it. */
  headline: string;
  /** How many steps did not work. */
  failed: number;
  /** Those steps, each in its own words. */
  problems: string[];
}

/** One step that did not work, named: "TrackIR: TrackIR5.exe is still running: ...". */
export function problemText(step: { title: string; message: string }): string {
  const message = step.message.trim();
  if (message === '') return `${step.title} did not work.`;
  // A message that names the thing itself needs no name in front of it.
  return message.toLowerCase().includes(step.title.toLowerCase())
    ? message
    : `${step.title}: ${message}`;
}

/**
 * What a Stand down that ran by itself has to say. `ok` only when every step worked: a
 * Stand down that left something undone never reads as done, and says what was left.
 */
export function stoodDownText(down: StoodDown): { ok: boolean; title: string; lines: string[] } {
  if (!down.finished) {
    return { ok: false, title: 'Stand down did not finish', lines: down.problems };
  }
  if (down.failed === 0) return { ok: true, title: 'Stood down', lines: [down.headline] };
  return {
    ok: false,
    title: `Stand down ran, but ${down.failed} ${down.failed === 1 ? 'step needs' : 'steps need'} attention`,
    lines: down.problems,
  };
}

/** The same in one line: "Stood down: Closed 2 apps". */
export function stoodDownLine(down: StoodDown): string {
  const { title, lines } = stoodDownText(down);
  return lines.length > 0 ? `${title}: ${lines.join(' ')}` : title;
}

/**
 * Seconds until Stand down starts by itself, for a window's clock that reads `now`.
 * Never more than the countdown's own length: a clock read a moment before the countdown
 * started must not show "1 minute 1 second" for a countdown of one minute.
 */
export function countdownLeft(standDownAt: string, now: number, length?: number): number {
  const left = Math.max(0, (Date.parse(standDownAt) - now) / 1000);
  return length === undefined ? left : Math.min(left, length);
}

/** The countdown as its heading: "Stand down in 42 seconds". */
export function countdownTitle(secondsLeft: number): string {
  const left = Math.ceil(secondsLeft);
  return left > 0 ? `Stand down in ${standDownWaitText(left)}` : 'Stand down is about to start';
}

/** The countdown where there is little room, in the app bar: "Stand down in 4:05". */
export function countdownShort(secondsLeft: number): string {
  const left = Math.max(0, Math.ceil(secondsLeft));
  return `Stand down in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * Why Stand down is not running by itself this time, although the setup asks for it.
 * `short` is for the compact view, where it has one line under how long the session was;
 * the full sentence is that line's tooltip.
 */
export function standDownHeldText(held: 'cancelled' | 'quickExit', short = false): string {
  if (held === 'cancelled') return 'Stand down was cancelled. Nothing was closed.';
  return short
    ? 'It closed too soon: Stand down did not start.'
    : 'It closed within two minutes of starting, so Stand down did not start by itself.';
}

/** The history in one line: "12 sessions, 14 h; TrackIR needed starting 6 times". */
export function totalsLine(totals: SessionTotals): string {
  if (totals.sessions === 0) return 'No sessions yet';
  const head = `${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'}, ${totalText(totals.seconds)}`;
  const top = totals.fixes[0];
  return top ? `${head}; ${fixTotalText(top)}` : head;
}
