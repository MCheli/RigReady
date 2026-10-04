/**
 * WOW-UI-004: the design system (src/renderer/styles.css) keeps what every screen is
 * written against, and what it adds holds to the direction of the final pass: two steps of
 * depth, a type scale with digits of one width, one focus ring, and motion that is short,
 * eased out, never bouncing, and off for those who ask for less of it.
 */
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

const css = readFileSync(path.join(repoRoot, 'src', 'renderer', 'styles.css'), 'utf8');
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties declared in the first :root block. */
const root = /:root\s*\{([\s\S]*?)\n\}/.exec(plain)![1]!;
const token = (name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.replace(/\s+/g, ' ').trim();

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

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await sources(full)));
    } else if (/\.(vue|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the design system keeps what the screens are written against', () => {
  it('every token the features use is still there, with the colour it had', () => {
    // The dark theme as it was: the surfaces, text and status colours are not re-cut.
    expect(token('--rr-bg')).toBe('#0f1317');
    expect(token('--rr-surface')).toBe('#171c22');
    expect(token('--rr-surface-2')).toBe('#1e252d');
    expect(token('--rr-border')).toBe('#262d36');
    expect(token('--rr-text')).toBe('#e6e9ed');
    expect(token('--rr-muted')).toBe('#8b95a3');
    expect(token('--rr-ok')).toBe('#3fb97f');
    expect(token('--rr-warn')).toBe('#e2b23c');
    expect(token('--rr-bad')).toBe('#ee635b');
    expect(token('--rr-accent')).toBe('#5aa9e6');
    expect(token('--rr-focus')).toBe('#a8d1f5');
    expect(token('--rr-radius')).toBe('10px');
  });

  it('every shared class is still defined', () => {
    for (const name of [
      'rr-page',
      'rr-page-title',
      'rr-page-sub',
      'rr-panel',
      'rr-section-title',
      'rr-row',
      'rr-row-main',
      'rr-row-title',
      'rr-row-sub',
      'rr-mono',
      'rr-ok',
      'rr-warn',
      'rr-bad',
      'rr-muted',
      'rr-empty',
      // Added by the final pass.
      'rr-kbd',
      'rr-num',
      'rr-sr-only',
    ]) {
      expect(plain, name).toMatch(new RegExp(`\\.${name}\\b[^{]*\\{`));
    }
  });

  it('no stylesheet or component uses a token that is not defined', async () => {
    const defined = new Set([...plain.matchAll(/(--rr-[\w-]+)\s*:/g)].map((m) => m[1]!));
    const missing: string[] = [];
    for (const file of await sources(path.join(repoRoot, 'src'))) {
      const text = (await fs.readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      // Set in the same file (a component's own variable) counts as defined there.
      const own = new Set([...text.matchAll(/(--rr-[\w-]+)\s*:/g)].map((m) => m[1]!));
      for (const use of text.matchAll(/var\(\s*(--rr-[\w-]+)\s*(,)?/g)) {
        const name = use[1]!;
        // A fallback after the comma says what to use while it is not set.
        if (use[2] || defined.has(name) || own.has(name)) continue;
        missing.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}: ${name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
    expect(defined.size).toBeGreaterThan(25);
  });
});

describe('what the final pass added', () => {
  it('depth has two steps: a panel lies on the page, a dialog floats above it', () => {
    expect(token('--rr-elev-1')).toMatch(/inset .*rgba\(/);
    expect(token('--rr-elev-2')).toMatch(/var\(--rr-border-strong\)/);
    expect(plain).toMatch(/\.rr-panel\s*\{[^}]*box-shadow:\s*var\(--rr-elev-1\)/);
    expect(plain).toMatch(/\.v-dialog[^{]*\{[^}]*box-shadow:\s*var\(--rr-elev-2\)/);
    // The firmer edge stands out from every surface it is drawn on, without being text.
    const edge = token('--rr-border-strong')!;
    for (const surface of ['--rr-bg', '--rr-surface', '--rr-surface-2']) {
      expect(contrast(edge, token(surface)!), surface).toBeGreaterThan(1.25);
    }
    expect(luminance(edge)).toBeGreaterThan(luminance(token('--rr-border')!));
  });

  it('the type scale is a scale, and digits have one width', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'].map((step) =>
      parseFloat(token(`--rr-text-${step}`)!)
    );
    expect(sizes).toEqual([12, 13, 14, 16, 22]);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(token('--rr-font')).toMatch(/Segoe UI/);
    expect(token('--rr-font-mono')).toMatch(/Cascadia Mono/);
    expect(plain).toMatch(/body\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(plain).toMatch(/\.rr-num\s*\{[^}]*tabular-nums/);
  });

  it('the text for running explanation is readable on every surface (WCAG AA)', () => {
    for (const surface of ['--rr-bg', '--rr-surface', '--rr-surface-2']) {
      expect(contrast(token('--rr-text-2')!, token(surface)!), surface).toBeGreaterThanOrEqual(4.5);
    }
    // Softer than a heading, clearer than what steps back.
    expect(luminance(token('--rr-text-2')!)).toBeLessThan(luminance(token('--rr-text')!));
    expect(luminance(token('--rr-text-2')!)).toBeGreaterThan(luminance(token('--rr-muted')!));
  });

  it('there is one focus ring: two pixels of the focus colour, on every kind of control', () => {
    const ring = /:where\(([\s\S]*?)\):focus-visible\s*\{([^}]*)\}/.exec(plain)!;
    expect(ring[2]).toMatch(/outline:\s*2px solid var\(--rr-focus\)/);
    for (const control of ['a', 'button', "[role='tab']", "[role='option']", '[tabindex]']) {
      expect(ring[1], control).toContain(control);
    }
    // No other outline colour anywhere in the design system.
    const outlines = [...plain.matchAll(/outline:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(outlines.filter((o) => o !== 'none' && !o.includes('var(--rr-focus)'))).toEqual([]);
  });

  it('motion is short and eased out, with no bounce', () => {
    const fast = parseFloat(token('--rr-motion-fast')!);
    const base = parseFloat(token('--rr-motion-base')!);
    expect(token('--rr-motion-fast')).toMatch(/^\d+ms$/);
    expect(fast).toBeGreaterThanOrEqual(120);
    expect(base).toBeLessThanOrEqual(200);
    expect(fast).toBeLessThan(base);
    const curve = /^cubic-bezier\(([^)]+)\)$/.exec(token('--rr-ease')!)![1]!.split(',').map(Number);
    const [x1, y1, x2, y2] = curve as [number, number, number, number];
    // Inside the unit square: the value never runs past its end and comes back.
    for (const y of [y1, y2]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // Eased out: it starts quickly and settles (the curve ends flat).
    expect(y1 / Math.max(x1, 0.001)).toBeGreaterThanOrEqual(0);
    expect(y2).toBe(1);
    expect(x2).toBeLessThan(0.5);
    // Pages and dialogs arrive on these tokens, not on numbers of their own.
    expect(plain).toMatch(
      /\.rr-page\s*\{[^}]*animation:\s*rr-page-in var\(--rr-motion-base\) var\(--rr-ease\)/
    );
    expect(plain).toMatch(
      /\.rr-dialog-enter-active\s*\{[^}]*var\(--rr-motion-base\) var\(--rr-ease\)/
    );
    expect(plain).toMatch(/\.rr-dialog-leave-active\s*\{[^}]*var\(--rr-motion-fast\)/);
  });

  it('asking Windows for less motion switches it off: the tokens are zero and nothing animates', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(
      plain
    )![1]!;
    expect(reduced).toMatch(/--rr-motion-fast:\s*0ms/);
    expect(reduced).toMatch(/--rr-motion-base:\s*0ms/);
    // Everything else that would move takes no time at all: a component that switches its
    // own motion off, and checks that it is off, finds "0s" and not "nearly".
    const everything = /\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/.exec(reduced)![1]!;
    expect(everything).toMatch(/animation-duration:\s*0s\s*!important/);
    expect(everything).toMatch(/transition-duration:\s*0s\s*!important/);
  });

  it('less motion takes away the time only: how often an animation repeats and whether it is held stay as they were', () => {
    // Every field carries a loading bar whose animation never ends and is paused until it
    // is needed. Made to run once, it would be an animation that is held and can never
    // finish, and whatever waits for the page to stand still (a screenshot) would wait
    // for ever. On the tree of all the branches of the final pass that stopped two flows.
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(
      plain
    )![1]!;
    expect(reduced).not.toMatch(/animation-iteration-count/);
    expect(reduced).not.toMatch(/animation-play-state/);
    expect(reduced).not.toMatch(/animation:\s*none/);
    // One thing is drawn differently instead of not at all: a busy bar, whole and dimmed.
    const busy =
      /\.v-progress-linear--active \.v-progress-linear__indeterminate\s*\{([^}]*)\}/.exec(
        reduced
      )![1]!;
    expect(busy).toMatch(/animation-name:\s*none\s*!important/);
    expect(busy).toMatch(/--v-progress-indeterminate-long-left:\s*0%/);
    expect(busy).toMatch(/--v-progress-indeterminate-long-right:\s*0%/);
  });

  it('no component of the shell animates on a number of its own', async () => {
    // Every duration in the shell's own components is one of the two tokens. The one
    // exception is the slow sweep of the loading outline, which is not a movement of the
    // interface and is switched off with the rest.
    const offenders: string[] = [];
    const shell = (await sources(path.join(repoRoot, 'src', 'renderer'))).filter(
      (file) => !file.endsWith('styles.css')
    );
    expect(shell.length).toBeGreaterThan(8);
    for (const file of shell) {
      const text = (await fs.readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const declaration of text.matchAll(
        /\b(transition|animation)(?:-duration)?:\s*([^;]+);/g
      )) {
        const value = declaration[2]!;
        if (value.trim() === 'none') continue;
        if (/rr-skeleton-sweep/.test(value)) continue;
        if (/\d+m?s\b/.test(value.replace(/var\([^)]*\)/g, ''))) {
          offenders.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}: ${value.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the accent for a racing setup is seen, is not a status colour, and is only set by the shell', () => {
    const racing = token('--rr-kind-racing')!;
    // A mark, not text: three to one on every surface it is drawn on.
    for (const surface of ['--rr-bg', '--rr-surface', '--rr-surface-2']) {
      expect(contrast(racing, token(surface)!), surface).toBeGreaterThanOrEqual(3);
    }
    // Far from green, amber and red around the colour wheel, and apart from the blue of controls.
    for (const status of ['--rr-ok', '--rr-warn', '--rr-bad']) {
      expect(hueDistance(racing, token(status)!), status).toBeGreaterThan(90);
    }
    expect(hueDistance(racing, token('--rr-accent')!)).toBeGreaterThan(30);
    // --rr-kind exists only under the attribute the shell sets; everywhere else it falls
    // back to the accent, so a flight setup and no setup look exactly as before.
    const set = [...plain.matchAll(/([^{}]+)\{[^{}]*--rr-kind:\s*([^;]+);/g)].map((m) => [
      m[1]!.trim(),
      m[2]!.trim(),
    ]);
    expect(set).toEqual([[":root[data-rig-kind='racing']", 'var(--rr-kind-racing)']]);
    expect(root).not.toMatch(/--rr-kind:/);
  });
});

/** Degrees between two colours around the colour wheel, 0 to 180. */
function hueDistance(a: string, b: string): number {
  const hue = (hex: string): number => {
    const [r, g, bl] = rgb(hex).map((v) => v / 255) as [number, number, number];
    const max = Math.max(r, g, bl);
    const min = Math.min(r, g, bl);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const apart = Math.abs(hue(a) - hue(b));
  return Math.min(apart, 360 - apart);
}
