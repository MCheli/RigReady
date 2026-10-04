import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TONE_RGB } from '../../src/main/trayModel';
import { repoRoot } from '../helpers';

/**
 * NFR-011: the dark theme is readable. Every text colour of the design system
 * (src/renderer/styles.css) against every surface it is drawn on, and the text on filled
 * buttons (the Vuetify theme in src/renderer/main.ts), at WCAG AA: 4.5:1 for text, 3:1 for
 * the focus ring and for large status icons. A token changed to something unreadable fails
 * here before any screen is opened; tests/e2e/a11y.e2e.ts checks the screens themselves.
 */

const css = readFileSync(path.join(repoRoot, 'src', 'renderer', 'styles.css'), 'utf8');
const main = readFileSync(path.join(repoRoot, 'src', 'renderer', 'main.ts'), 'utf8');

const tokens: Record<string, string> = Object.fromEntries(
  [...css.matchAll(/(--rr-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!])
);
const theme: Record<string, string> = Object.fromEntries(
  [...main.matchAll(/'?([\w-]+)'?:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1]!, m[2]!])
);

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function luminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour at this opacity over a background: what a tonal alert or a tinted row paints. */
function mix(top: string, under: string, alpha: number): string {
  const [a, b] = [rgb(top), rgb(under)];
  const part = (i: 0 | 1 | 2): string =>
    Math.round(a[i] * alpha + b[i] * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${part(0)}${part(1)}${part(2)}`;
}

const SURFACES = ['--rr-bg', '--rr-surface', '--rr-surface-2'] as const;
const TEXT = ['--rr-text', '--rr-muted', '--rr-ok', '--rr-warn', '--rr-bad', '--rr-accent'];

describe('theme contrast (WCAG AA)', () => {
  it('reads the tokens it tests from the design system', () => {
    for (const token of [...SURFACES, ...TEXT, '--rr-focus', '--rr-border']) {
      expect(tokens[token], token).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('every text colour is at least 4.5:1 on every surface', () => {
    const failures: string[] = [];
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        const ratio = contrast(tokens[text]!, tokens[surface]!);
        if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('status colours stay readable on their own tint (a tonal alert, a highlighted row)', () => {
    const failures: string[] = [];
    for (const tone of ['--rr-ok', '--rr-warn', '--rr-bad', '--rr-accent']) {
      // Vuetify's tonal variant paints the colour at 12% over the surface.
      const tinted = mix(tokens[tone]!, tokens['--rr-surface']!, 0.12);
      const ratio = contrast(tokens[tone]!, tinted);
      if (ratio < 4.5) failures.push(`${tone} on its own tint: ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it('the focus ring stands out from every surface (3:1)', () => {
    for (const surface of SURFACES) {
      expect(contrast(tokens['--rr-focus']!, tokens[surface]!), surface).toBeGreaterThanOrEqual(3);
    }
    // And from a filled primary button, around which it is drawn with a gap of background.
    expect(contrast(tokens['--rr-focus']!, tokens['--rr-bg']!)).toBeGreaterThanOrEqual(3);
  });

  it('text on filled buttons and alerts is at least 4.5:1', () => {
    const failures: string[] = [];
    for (const name of ['primary', 'success', 'warning', 'error', 'info']) {
      const on = theme[`on-${name}`];
      expect(on, `on-${name} is set in the theme`).toBeDefined();
      const ratio = contrast(on!, theme[name]!);
      if (ratio < 4.5) failures.push(`on-${name} on ${name}: ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it('the Vuetify theme, the tray badge and the tokens are the same colours', () => {
    expect(theme['background']).toBe(tokens['--rr-bg']);
    expect(theme['surface']).toBe(tokens['--rr-surface']);
    expect(theme['primary']).toBe(tokens['--rr-accent']);
    expect(theme['success']).toBe(tokens['--rr-ok']);
    expect(theme['warning']).toBe(tokens['--rr-warn']);
    expect(theme['error']).toBe(tokens['--rr-bad']);
    expect([...TONE_RGB.ok]).toEqual(rgb(tokens['--rr-ok']!));
    expect([...TONE_RGB.warn]).toEqual(rgb(tokens['--rr-warn']!));
    expect([...TONE_RGB.bad]).toEqual(rgb(tokens['--rr-bad']!));
  });
});
