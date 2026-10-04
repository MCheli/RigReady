import { describe, expect, it } from 'vitest';
import {
  TRIM_AFTER_HIDE_MS,
  TRIM_EVERY_MS,
  TrayMemoryTrimmer,
  type TrimTimer,
} from '../../src/main/trayMemory';
import { trimWorkingSets } from '../../src/platform/windows/memory';

/** A timer the test advances by hand. */
class ManualTimer implements TrimTimer {
  now = 0;
  private pending: { at: number; fn: () => void }[] = [];
  set(fn: () => void, ms: number): unknown {
    const entry = { at: this.now + ms, fn };
    this.pending.push(entry);
    return entry;
  }
  clear(handle: unknown): void {
    this.pending = this.pending.filter((entry) => entry !== handle);
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const next = this.pending.filter((e) => e.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.pending = this.pending.filter((entry) => entry !== next);
      this.now = next.at;
      next.fn();
    }
    this.now = until;
  }
  get count(): number {
    return this.pending.length;
  }
}

describe('memory while in the tray', () => {
  it('hands memory back shortly after the window is hidden, again once things are quiet, then every few minutes', () => {
    const timer = new ManualTimer();
    let trims = 0;
    const trimmer = new TrayMemoryTrimmer(() => trims++, timer);
    expect(timer.count).toBe(0);

    trimmer.onHidden();
    timer.advance(TRIM_AFTER_HIDE_MS[0]! - 1);
    expect(trims).toBe(0);
    timer.advance(1);
    expect(trims).toBe(1);
    timer.advance(TRIM_AFTER_HIDE_MS[1]! - TRIM_AFTER_HIDE_MS[0]!);
    expect(trims).toBe(2);
    timer.advance(TRIM_EVERY_MS);
    expect(trims).toBe(3);
    timer.advance(TRIM_EVERY_MS * 3);
    expect(trims).toBe(6);
  });

  it('stops the moment the window is shown, and starts over when it is hidden again', () => {
    const timer = new ManualTimer();
    let trims = 0;
    const trimmer = new TrayMemoryTrimmer(() => trims++, timer);
    trimmer.onHidden();
    timer.advance(TRIM_AFTER_HIDE_MS[0]!);
    expect(trims).toBe(1);
    trimmer.onShown();
    expect(timer.count).toBe(0);
    timer.advance(TRIM_EVERY_MS * 2);
    expect(trims).toBe(1);

    // Hidden twice in a row (hide to tray, then a login start): one schedule, not two.
    trimmer.onHidden();
    trimmer.onHidden();
    timer.advance(TRIM_AFTER_HIDE_MS[0]!);
    expect(trims).toBe(2);
  });

  it('trimming a real process works and a process that is gone is skipped without an error', () => {
    // This test process itself: its pages come back as they are touched.
    expect(trimWorkingSets([process.pid])).toBe(1);
    expect(trimWorkingSets([0x7ffffff0])).toBe(0);
    expect(trimWorkingSets([])).toBe(0);
  });
});
