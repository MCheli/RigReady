/**
 * The list behind "recent presses": the newest press first, each staying for a set time
 * after it was last pressed, at most a set number at once.
 *
 * Two things keep it readable on real controllers:
 *
 * - Pressing the same control again does not add a line; the newest line counts up and its
 *   time starts again.
 * - A control with several positions (a three-way switch, a lever with detents, a hat rolled
 *   round) is one line that changes, not a line per position it passed. Such a control lets
 *   go of one input and takes the next at the same moment, in either order, on the same
 *   controller; two separate buttons are practically never changed within a few hundredths
 *   of a second. So a press that comes with a release replaces the line of what was let go.
 *
 * Time comes from the caller (milliseconds), so nothing here runs on a timer: what has
 * outstayed its time is dropped when the list is next changed or read.
 */

/** A release and a press of one controller this close together are one control moving. */
export const SAME_MOVE_MS = 40;

export interface FeedLimits {
  /** How long a line stays after its last press. */
  lifetimeMs: number;
  /** The most lines at once. */
  rows: number;
}

export interface FeedEntry<T> {
  /** Stays the same while the line is the same control, also through its positions. */
  id: number;
  /** How many times running it was pressed. */
  count: number;
  /** When it was last pressed. */
  stamp: number;
  what: T;
}

interface Line<T> extends FeedEntry<T> {
  /** Controller and input. */
  key: string;
}

interface Moment {
  at: number;
  key: string;
}

export class PressFeed<T> {
  /** Newest first. */
  private lines: Line<T>[] = [];
  private nextId = 1;
  /** The last input each controller let go of, and took. */
  private readonly released = new Map<string, Moment>();
  private readonly pressed = new Map<string, Moment>();

  constructor(private limits: FeedLimits) {}

  /**
   * New limits apply to what is in the list already. What had outstayed the old time by now
   * goes first: a longer time does not bring back a line that was gone from the screen.
   */
  configure(limits: FeedLimits, now: number): void {
    this.prune(now);
    this.limits = limits;
    this.trim();
  }

  /** An input of a controller went down. */
  press(now: number, device: string, input: string, what: T): void {
    this.prune(now);
    const key = `${device}|${input}`;
    const newest = this.lines[0];
    const letGo = this.released.get(device);
    this.pressed.set(device, { at: now, key });
    if (newest?.key === key) {
      newest.count += 1;
      newest.stamp = now;
      newest.what = what;
      return;
    }
    const moved =
      letGo && letGo.key !== key && now - letGo.at <= SAME_MOVE_MS
        ? this.lines.findIndex((line) => line.key === letGo.key)
        : -1;
    if (moved >= 0) {
      // The same control in its next position: the same line, now newest.
      const [line] = this.lines.splice(moved, 1);
      this.lines.unshift({ id: line!.id, key, count: 1, stamp: now, what });
    } else {
      this.lines.unshift({ id: this.nextId++, key, count: 1, stamp: now, what });
    }
    this.trim();
  }

  /**
   * An input of a controller came up. Answers true when that changed the list: the control
   * had taken its next position a moment before it let go of this one, so the line of this
   * one is the same control and goes.
   */
  release(now: number, device: string, input: string): boolean {
    const key = `${device}|${input}`;
    this.released.set(device, { at: now, key });
    const taken = this.pressed.get(device);
    if (!taken || taken.key === key || now - taken.at > SAME_MOVE_MS) return false;
    const old = this.lines.findIndex((line) => line.key === key);
    const next = this.lines.findIndex((line) => line.key === taken.key);
    // Only a line older than the one just taken: never the newest.
    if (old < 0 || next < 0 || old < next) return false;
    this.lines.splice(old, 1);
    return true;
  }

  /** What is shown at this moment, newest first. */
  rows(now: number): FeedEntry<T>[] {
    this.prune(now);
    return this.lines.map(({ id, count, stamp, what }) => ({ id, count, stamp, what }));
  }

  clear(): void {
    this.lines = [];
    this.released.clear();
    this.pressed.clear();
  }

  private prune(now: number): void {
    if (this.lines.some((line) => now - line.stamp >= this.limits.lifetimeMs)) {
      this.lines = this.lines.filter((line) => now - line.stamp < this.limits.lifetimeMs);
    }
  }

  /** The oldest make room: the newest is always there. */
  private trim(): void {
    const most = Math.max(1, this.limits.rows);
    if (this.lines.length > most) this.lines.length = most;
  }
}
