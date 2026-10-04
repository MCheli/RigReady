/**
 * While RigReady sits in the tray with its window hidden, the memory it is not using is
 * handed back to Windows: shortly after the window is hidden, once more when the
 * renderer has gone quiet, and then every few minutes. Showing the window stops it.
 *
 * Pure scheduling; what "trim" does is given by the caller (the Electron bootstrap).
 */
export const TRIM_AFTER_HIDE_MS = [3_000, 20_000];
export const TRIM_EVERY_MS = 3 * 60_000;

export interface TrimTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const systemTimer: TrimTimer = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TrayMemoryTrimmer {
  private handles: unknown[] = [];
  private hidden = false;

  constructor(
    private readonly trim: () => void,
    private readonly timer: TrimTimer = systemTimer
  ) {}

  /** The window was hidden to the tray. */
  onHidden(): void {
    this.cancel();
    this.hidden = true;
    for (const ms of TRIM_AFTER_HIDE_MS) this.handles.push(this.timer.set(() => this.trim(), ms));
    const repeat = (): void => {
      this.handles.push(
        this.timer.set(() => {
          if (!this.hidden) return;
          this.trim();
          repeat();
        }, TRIM_EVERY_MS)
      );
    };
    repeat();
  }

  /** The window is on screen again: RigReady is in use and keeps its memory. */
  onShown(): void {
    this.hidden = false;
    this.cancel();
  }

  private cancel(): void {
    for (const handle of this.handles) this.timer.clear(handle);
    this.handles = [];
  }
}
