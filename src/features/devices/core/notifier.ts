import type { DeviceInfo } from '../../../shared/models';

/**
 * Turns plug and unplug events into tray notifications. Events that arrive within a short
 * settle time are told in one notification (a hub with five devices on it is one message),
 * and a device that keeps dropping out and coming back (USB flapping) is told once: further
 * changes of that device within the quiet time are held back, and only if it ends up in a
 * different state than the one told is there one follow-up.
 */

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface NotifierOptions {
  /** Shows one notification. */
  notify(title: string, body: string): void;
  /** Whether a notification about this device should be shown at all right now. */
  wanted(device: DeviceInfo): boolean;
  /** The name to show. */
  label(device: DeviceInfo): string;
  timers?: Timers;
  settleMs?: number;
  quietMs?: number;
}

interface Tracked {
  device: DeviceInfo;
  /** State before the first change of this burst. */
  before: boolean;
  now: boolean;
  /** Times it went away during the burst. */
  drops: number;
  phase: 'settling' | 'quiet';
  told?: boolean;
  quietTimer?: unknown;
}

export class ConnectionNotifier {
  private tracked = new Map<string, Tracked>();
  private settleTimer: unknown;
  private readonly timers: Timers;
  private readonly settleMs: number;
  private readonly quietMs: number;

  constructor(private readonly options: NotifierOptions) {
    this.timers = options.timers ?? realTimers;
    this.settleMs = options.settleMs ?? 1000;
    this.quietMs = options.quietMs ?? 3000;
  }

  /** Feeds the devices that appeared and disappeared since the last call. */
  changed(added: DeviceInfo[], removed: DeviceInfo[]): void {
    const events: [DeviceInfo, boolean][] = [
      ...removed.map((d): [DeviceInfo, boolean] => [d, false]),
      ...added.map((d): [DeviceInfo, boolean] => [d, true]),
    ];
    for (const [device, connected] of events) {
      if (device.isHub) continue;
      const key = device.instanceId.toUpperCase();
      const entry = this.tracked.get(key);
      if (!entry) {
        this.tracked.set(key, {
          device,
          before: !connected,
          now: connected,
          drops: connected ? 0 : 1,
          phase: 'settling',
        });
        this.settleTimer ??= this.timers.set(() => this.flushSettled(), this.settleMs);
        continue;
      }
      entry.device = device;
      entry.now = connected;
      if (!connected) entry.drops++;
      if (entry.phase === 'quiet') {
        this.timers.clear(entry.quietTimer);
        entry.quietTimer = this.timers.set(() => this.endQuiet(key), this.quietMs);
      }
    }
  }

  private flushSettled(): void {
    this.settleTimer = undefined;
    const ready = [...this.tracked.entries()].filter(([, e]) => e.phase === 'settling');
    const connected: Tracked[] = [];
    const disconnected: Tracked[] = [];
    const flapped: Tracked[] = [];
    for (const [key, entry] of ready) {
      entry.phase = 'quiet';
      entry.quietTimer = this.timers.set(() => this.endQuiet(key), this.quietMs);
      if (!this.options.wanted(entry.device)) continue;
      entry.told = true;
      if (entry.now === entry.before) flapped.push(entry);
      else if (entry.now) connected.push(entry);
      else disconnected.push(entry);
    }
    this.tell(disconnected, 'disconnected');
    this.tell(connected, 'connected');
    for (const entry of flapped) {
      const name = this.options.label(entry.device);
      this.options.notify(
        `${name} dropped out`,
        entry.now
          ? `It disconnected and came back${entry.drops > 1 ? ` (${entry.drops} times)` : ''}. A loose cable or a busy USB hub can cause this.`
          : 'It came back briefly and is disconnected again.'
      );
    }
    for (const entry of ready.map(([, e]) => e)) entry.before = entry.now;
  }

  private tell(entries: Tracked[], what: 'connected' | 'disconnected'): void {
    if (entries.length === 0) return;
    const names = entries.map((e) => this.options.label(e.device));
    if (entries.length === 1) {
      this.options.notify(
        `${names[0]} ${what}`,
        what === 'connected' ? 'Ready to use.' : 'It was unplugged or lost power.'
      );
      return;
    }
    const shown =
      names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
    this.options.notify(`${entries.length} devices ${what}`, shown);
  }

  private endQuiet(key: string): void {
    const entry = this.tracked.get(key);
    if (!entry || entry.phase !== 'quiet') return;
    this.tracked.delete(key);
    if (!entry.told || entry.now === entry.before) return;
    if (!this.options.wanted(entry.device)) return;
    const name = this.options.label(entry.device);
    this.options.notify(
      entry.now ? `${name} is back` : `${name} disconnected`,
      entry.now
        ? 'It dropped out again for a moment and has reconnected.'
        : 'It dropped out again and has not come back.'
    );
  }

  dispose(): void {
    if (this.settleTimer !== undefined) this.timers.clear(this.settleTimer);
    for (const entry of this.tracked.values()) {
      if (entry.quietTimer !== undefined) this.timers.clear(entry.quietTimer);
    }
    this.tracked.clear();
  }
}

/** Devices that appeared and disappeared between two lists (hubs left out). */
export function diffDevices(
  before: DeviceInfo[],
  after: DeviceInfo[]
): { added: DeviceInfo[]; removed: DeviceInfo[] } {
  const ids = (list: DeviceInfo[]): Set<string> =>
    new Set(list.filter((d) => !d.isHub).map((d) => d.instanceId.toUpperCase()));
  const was = ids(before);
  const is = ids(after);
  return {
    added: after.filter((d) => !d.isHub && !was.has(d.instanceId.toUpperCase())),
    removed: before.filter((d) => !d.isHub && !is.has(d.instanceId.toUpperCase())),
  };
}
