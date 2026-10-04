import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToasts, TOAST_MS, TOASTS_SHOWN } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const texts = (center: ReturnType<typeof createToasts>): string[] =>
  center.list.value.map((t) => t.text);

describe('toasts', () => {
  it('a toast goes away by itself, sooner for good news than for bad', () => {
    const center = createToasts();
    center.show({ tone: 'ok', text: 'Backed up' });
    center.show({ tone: 'bad', text: 'The backup failed' });
    expect(texts(center)).toEqual(['Backed up', 'The backup failed']);
    vi.advanceTimersByTime(TOAST_MS.ok);
    expect(texts(center)).toEqual(['The backup failed']);
    vi.advanceTimersByTime(TOAST_MS.bad - TOAST_MS.ok);
    expect(texts(center)).toEqual([]);
    expect(TOAST_MS.bad).toBeGreaterThan(TOAST_MS.warn);
    expect(TOAST_MS.warn).toBeGreaterThan(TOAST_MS.ok);
  });

  it('a busy toast stays until it becomes the outcome, which then gets its own time', () => {
    const center = createToasts();
    const id = center.show({ tone: 'busy', text: 'Backing up…' });
    vi.advanceTimersByTime(60_000);
    expect(texts(center)).toEqual(['Backing up…']);
    center.update(id, { text: 'Backing up… 3 of 9 files' });
    expect(center.list.value[0]).toMatchObject({ tone: 'busy', text: 'Backing up… 3 of 9 files' });
    center.update(id, {
      tone: 'ok',
      text: 'Backed up 9 files',
      action: { label: 'Open Backups', to: '/configure/backups' },
    });
    expect(center.list.value[0]).toEqual({
      id,
      tone: 'ok',
      text: 'Backed up 9 files',
      action: { label: 'Open Backups', to: '/configure/backups' },
    });
    vi.advanceTimersByTime(TOAST_MS.ok - 1);
    expect(center.list.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(center.list.value).toHaveLength(0);
  });

  it('an outcome without a second line or a button keeps none from the toast it replaces', () => {
    const center = createToasts();
    const id = center.show({
      tone: 'warn',
      text: 'Not kept',
      detail: 'The monitors went back.',
      action: { label: 'Open Monitors', to: '/configure/displays' },
    });
    center.update(id, { tone: 'ok', text: 'Kept', detail: undefined, action: undefined });
    expect(center.list.value[0]).toEqual({ id, tone: 'ok', text: 'Kept' });
    // A change that does not mention them leaves them alone.
    const other = center.show({ tone: 'busy', text: 'Working…', detail: 'Step 1' });
    center.update(other, { text: 'Still working…' });
    expect(center.list.value[1]).toMatchObject({ text: 'Still working…', detail: 'Step 1' });
  });

  it('stays while the pointer or the focus is on it, and its time starts again afterwards', () => {
    const center = createToasts();
    const id = center.show({ tone: 'ok', text: 'Copied' });
    vi.advanceTimersByTime(TOAST_MS.ok - 100);
    center.hold(id);
    vi.advanceTimersByTime(60_000);
    expect(texts(center)).toEqual(['Copied']);
    // Changed while held: still held.
    center.update(id, { text: 'Copied again' });
    vi.advanceTimersByTime(60_000);
    expect(texts(center)).toEqual(['Copied again']);
    center.release(id);
    vi.advanceTimersByTime(TOAST_MS.ok - 1);
    expect(texts(center)).toEqual(['Copied again']);
    vi.advanceTimersByTime(1);
    expect(texts(center)).toEqual([]);
  });

  it('can be dismissed, and dismissing or changing one that is gone does nothing', () => {
    const center = createToasts();
    const id = center.show({ tone: 'info', text: 'Nothing was pressed' });
    center.dismiss(id);
    expect(center.list.value).toEqual([]);
    center.dismiss(id);
    center.update(id, { text: 'Back from the dead' });
    center.hold(id);
    center.release(id);
    expect(center.list.value).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(center.list.value).toEqual([]);
  });

  it('shows only so many: the oldest goes, but never the new one and not one still working if another can', () => {
    const center = createToasts();
    const busy = center.show({ tone: 'busy', text: 'Make ready…' });
    for (let i = 1; i <= TOASTS_SHOWN; i++) center.show({ tone: 'ok', text: `Done ${i}` });
    expect(center.list.value).toHaveLength(TOASTS_SHOWN);
    expect(center.list.value[0]!.id).toBe(busy);
    expect(texts(center)).not.toContain('Done 1');
    expect(texts(center)).toContain(`Done ${TOASTS_SHOWN}`);
    // Only busy ones left to drop: the oldest of them goes.
    const all = createToasts();
    const first = all.show({ tone: 'busy', text: 'One…' });
    for (let i = 0; i < TOASTS_SHOWN; i++) all.show({ tone: 'busy', text: `More ${i}…` });
    expect(all.list.value.some((t) => t.id === first)).toBe(false);
    expect(all.list.value).toHaveLength(TOASTS_SHOWN);
  });

  it('gives every toast an id of its own', () => {
    const center = createToasts();
    const ids = [1, 2, 3].map((n) => center.show({ tone: 'info', text: String(n) }));
    expect(new Set(ids).size).toBe(3);
  });
});
