import type { CheckGroup } from '../../../core/profile/schema';

/**
 * The words for a session: how long it was, when it was, what the history adds up to.
 * Pure and free of Node, so the screen and the notification say the same thing.
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

/** The history in one line: "12 sessions, 14 h; TrackIR needed starting 6 times". */
export function totalsLine(totals: SessionTotals): string {
  if (totals.sessions === 0) return 'No sessions yet';
  const head = `${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'}, ${totalText(totals.seconds)}`;
  const top = totals.fixes[0];
  return top ? `${head}; ${fixTotalText(top)}` : head;
}
