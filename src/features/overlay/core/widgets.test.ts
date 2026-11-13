import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  defineWidget,
  RECENT_PRESSES,
  RECENT_PRESSES_GAP,
  RECENT_PRESSES_PAD,
  RECENT_PRESSES_SIZES,
  recentPresses,
  WIDGET_KINDS,
  widgetKind,
} from './widgets';

describe('the widgets of the overlay', () => {
  it('are found by id, and an id that is none is not', () => {
    expect(widgetKind(RECENT_PRESSES)).toBe(recentPresses);
    expect(widgetKind('stick-position')).toBeUndefined();
    expect(new Set(WIDGET_KINDS.map((kind) => kind.id)).size).toBe(WIDGET_KINDS.length);
  });

  it('a new kind takes an id, words, a default place, options with defaults and a size', () => {
    const stick = defineWidget({
      id: 'stick-position',
      title: 'Stick position',
      summary: 'Where the stick is.',
      defaultAt: { x: 0, y: 1 },
      schema: z.object({ side: z.number().int().min(60).max(400).default(120) }),
      size: (options) => ({ width: options.side, height: options.side }),
    });
    expect(stick.options(undefined)).toEqual({ side: 120 });
    expect(stick.options({ side: 200 })).toEqual({ side: 200 });
    expect(stick.size({ side: 200 })).toEqual({ width: 200, height: 200 });
    expect(stick.check({ side: 20 })).toMatchObject({
      ok: false,
      error: { code: 'overlay.options' },
    });
  });

  it('refuses an id that could not be part of an address or a file key', () => {
    const make = (id: string) =>
      defineWidget({
        id,
        title: 'X',
        summary: 'X.',
        defaultAt: { x: 0, y: 0 },
        schema: z.object({}),
        size: () => ({ width: 1, height: 1 }),
      });
    expect(() => make('Stick Position')).toThrow(/Invalid widget id/);
    expect(() => make('../x')).toThrow(/Invalid widget id/);
    expect(make('stick-2').id).toBe('stick-2');
  });
});

describe('the options of the recent presses', () => {
  it('are five seconds, five rows, medium, and unbound presses shown, until the user says otherwise', () => {
    expect(recentPresses.read(undefined)).toEqual({
      lifetimeSeconds: 5,
      rows: 5,
      size: 'medium',
      showUnbound: true,
    });
    expect(recentPresses.read({})).toEqual(recentPresses.read(undefined));
  });

  it('keeps what the user set and fills in what is missing', () => {
    expect(recentPresses.read({ lifetimeSeconds: 12, showUnbound: false })).toEqual({
      lifetimeSeconds: 12,
      rows: 5,
      size: 'medium',
      showUnbound: false,
    });
  });

  it('stored options that do not fit (a file edited by hand) are replaced by the defaults, whole', () => {
    expect(recentPresses.read({ lifetimeSeconds: 900, rows: 3 })).toEqual(recentPresses.read({}));
    expect(recentPresses.read('nonsense')).toEqual(recentPresses.read({}));
  });

  it('options the user is setting are checked, and what is wrong is said', () => {
    expect(
      recentPresses.check({ lifetimeSeconds: 2, rows: 3, size: 'large', showUnbound: false })
    ).toEqual({
      ok: true,
      value: { lifetimeSeconds: 2, rows: 3, size: 'large', showUnbound: false },
    });
    for (const bad of [
      { lifetimeSeconds: 0 },
      { lifetimeSeconds: 31 },
      { rows: 0 },
      { rows: 2.5 },
      { rows: 11 },
      { size: 'huge' },
      { showUnbound: 'yes' },
      null,
    ]) {
      const checked = recentPresses.check(bad);
      expect(checked.ok, JSON.stringify(bad)).toBe(false);
      if (!checked.ok) {
        expect(checked.error.code).toBe('overlay.options');
        expect(checked.error.message).toContain('Recent presses');
      }
    }
  });

  it('the window is exactly as big as the most rows it may show', () => {
    const { width, row } = RECENT_PRESSES_SIZES.medium;
    expect(recentPresses.size({})).toEqual({
      width: width + 2 * RECENT_PRESSES_PAD,
      height: 2 * RECENT_PRESSES_PAD + 5 * row + 4 * RECENT_PRESSES_GAP,
    });
    const one = recentPresses.size({ rows: 1, size: 'small' });
    expect(one.height).toBe(2 * RECENT_PRESSES_PAD + RECENT_PRESSES_SIZES.small.row);
    const big = recentPresses.size({ rows: 10, size: 'large' });
    expect(big.width).toBeGreaterThan(one.width);
    // Ten large rows still fit a 1080 screen.
    expect(big.height).toBeLessThan(1080);
  });
});
