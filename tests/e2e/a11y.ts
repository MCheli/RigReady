import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { repoRoot } from './harness';

/**
 * Accessibility checks an e2e flow can run on whatever is on screen (NFR-011).
 *
 *   expect(await axeViolations(page)).toEqual([]);     // contrast and names (axe-core)
 *   expect(await colourOnlyStatus(page)).toEqual([]);  // status never by colour alone
 *
 * `axeViolations` runs the axe rules for colour contrast (WCAG AA) and for accessible names
 * and valid ARIA. `colourOnlyStatus` looks at the rendered page: everything drawn in a status
 * colour (green, yellow, red) must also have an icon and words.
 */

/**
 * The page's side, typed by hand: the test project is compiled for Node, without the DOM
 * library, so code that runs inside the page gets its globals through this.
 *
 *   page.evaluate(() => { const { document, getComputedStyle } = globalThis as unknown as Dom; ... })
 */
export interface El {
  tagName: string;
  id: string;
  textContent: string | null;
  outerHTML: string;
  parentElement: El | null;
  children: Iterable<El>;
  childNodes: Iterable<{ nodeType: number; textContent: string | null }>;
  classList: { contains(name: string): boolean };
  style: { color: string };
  matches(selector: string): boolean;
  closest(selector: string): El | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
  appendChild(child: El): void;
  remove(): void;
}
export interface ElStyle {
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  opacity: string;
  visibility: string;
  display: string;
  fontSize: string;
  fontWeight: string;
  content: string;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  getPropertyValue(name: string): string;
}
export interface Dom {
  document: {
    documentElement: El;
    body: El;
    activeElement: El | null;
    createElement(tag: string): El;
    querySelector(selector: string): El | null;
    getAnimations(): {
      playState: string;
      effect: { getComputedTiming(): { iterations?: number; endTime?: unknown } } | null;
    }[];
  };
  getComputedStyle(el: El, pseudo?: string): ElStyle;
  requestAnimationFrame(callback: () => void): void;
}
/** nodeType of a text node. */
const TEXT_NODE = 3;

const axeSource = readFileSync(createRequire(__filename).resolve('axe-core/axe.min.js'), 'utf8');

/** Contrast, and everything about names and ARIA being present and valid. */
export const AXE_RULES = [
  'color-contrast',
  'button-name',
  'link-name',
  'label',
  'select-name',
  'input-button-name',
  'image-alt',
  'role-img-alt',
  'svg-img-alt',
  'aria-allowed-attr',
  'aria-allowed-role',
  'aria-command-name',
  'aria-dialog-name',
  'aria-hidden-body',
  'aria-hidden-focus',
  'aria-input-field-name',
  'aria-meter-name',
  'aria-progressbar-name',
  'aria-required-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-roles',
  'aria-toggle-field-name',
  'aria-tooltip-name',
  'aria-valid-attr',
  'aria-valid-attr-value',
] as const;

export interface AxeFinding {
  rule: string;
  target: string;
  html: string;
  why: string;
}

interface AxeNode {
  target: unknown[];
  html: string;
  failureSummary?: string;
  any?: { message?: string; data?: { messageKey?: string } }[];
}
interface AxeResults {
  violations: { id: string; nodes: AxeNode[] }[];
  incomplete: { id: string; nodes: AxeNode[] }[];
}

/** Waits until nothing on the page is still fading or sliding (spinners turn forever and do not count). */
export function settled(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { document, requestAnimationFrame } = globalThis as unknown as Dom;
        const moving = (): boolean =>
          document
            .getAnimations()
            .some(
              (a) =>
                a.playState === 'running' &&
                a.effect?.getComputedTiming().iterations !== Infinity &&
                (a.effect?.getComputedTiming().endTime as number) < 5000
            );
        const wait = (): void => {
          if (moving()) requestAnimationFrame(wait);
          else resolve();
        };
        wait();
      })
  );
}

/**
 * Runs axe on the page as it is now. `exclude` takes CSS selectors that are not scanned;
 * every use must say why in a comment next to it.
 *
 * Where axe cannot judge a text's contrast because something lies across it (a floating
 * field label on its outline, say), the contrast is worked out here from the text colour
 * and the nearest painted background, and reported as `color-contrast (computed)` when it
 * is below WCAG AA. So "could not tell" never passes for "fine".
 */
export async function axeViolations(
  page: Page,
  options: { exclude?: string[] } = {}
): Promise<AxeFinding[]> {
  // Through the debugger, not a script tag: the app's content security policy allows no inline script.
  await page.evaluate(`if (!window.axe) { ${axeSource} }`);
  await settled(page);
  const results = (await page.evaluate(
    ([rules, exclude]) =>
      (
        globalThis as unknown as {
          axe: { run(context: unknown, options: unknown): Promise<unknown> };
        }
      ).axe.run(
        { include: [['html']], exclude: (exclude as string[]).map((selector) => [selector]) },
        {
          runOnly: { type: 'rule', values: rules },
          resultTypes: ['violations', 'incomplete'],
        }
      ),
    [AXE_RULES, options.exclude ?? []] as const
  )) as AxeResults;
  const findings: AxeFinding[] = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      target: node.target.map(String).join(' '),
      html: node.html.replace(/\s+/g, ' ').slice(0, 160),
      why: (node.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 260),
    }))
  );

  const undecided = results.incomplete
    .filter((item) => item.id === 'color-contrast')
    .flatMap((item) => item.nodes)
    .filter((node) => node.target.length === 1 && typeof node.target[0] === 'string')
    .map((node) => node.target[0] as string);
  const computed = await page.evaluate((selectors) => {
    const { document, getComputedStyle } = globalThis as unknown as Dom;
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
      // color(srgb r g b / a) gives fractions; rgb() gives 0-255.
      const scale = value.startsWith('color(') ? 255 : 1;
      return [
        (parts[0] ?? 0) * scale,
        (parts[1] ?? 0) * scale,
        (parts[2] ?? 0) * scale,
        parts[3] ?? 1,
      ];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: 0 | 1 | 2): number =>
        (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const luminance = (c: Rgba): number => {
      const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    };
    const backgroundOf = (el: El): Rgba => {
      const layers: Rgba[] = [];
      for (let up: El | null = el; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.backgroundImage !== 'none') return [0, 0, 0, 0];
        const colour = parse(style.backgroundColor);
        if (colour[3] > 0) layers.push(colour);
        if (colour[3] === 1) break;
      }
      let result: Rgba = [255, 255, 255, 1];
      for (const layer of layers.reverse()) result = over(layer, result);
      return result;
    };
    const out: { selector: string; ratio: number; needed: number; html: string }[] = [];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el || !(el.textContent ?? '').trim()) continue;
      const style = getComputedStyle(el);
      if (Number(style.opacity) === 0 || el.closest('[disabled], [aria-disabled="true"]')) continue;
      const background = backgroundOf(el);
      if (background[3] === 0) continue;
      let opacity = 1;
      for (let up: El | null = el; up; up = up.parentElement) {
        opacity *= Number(getComputedStyle(up).opacity);
      }
      const colour = parse(style.color);
      const text = over([colour[0], colour[1], colour[2], colour[3] * opacity], background);
      const [a, b] = [luminance(text), luminance(background)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) {
        out.push({
          selector,
          ratio: Math.round(ratio * 100) / 100,
          needed,
          html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
        });
      }
    }
    return out;
  }, undecided);
  for (const item of computed) {
    findings.push({
      rule: 'color-contrast (computed)',
      target: item.selector,
      html: item.html,
      why: `contrast ${item.ratio}, needs ${item.needed}`,
    });
  }
  return findings;
}

export interface ColourOnlyFinding {
  problem: 'no icon' | 'no words';
  text: string;
  html: string;
}

/**
 * Status is never conveyed by colour alone, checked on the rendered page. Every visible
 * element whose own text is drawn in a status colour (the --rr-ok, --rr-warn and --rr-bad
 * tokens, or Vuetify's success, warning and error) must come with an icon: its own, one the
 * design system adds before it, one inside it, or an icon of the same colour in the row or
 * line it sits in. And every icon in a status colour must come with words: in the same row
 * or line, or as its accessible name.
 */
export function colourOnlyStatus(page: Page): Promise<ColourOnlyFinding[]> {
  return page.evaluate((textNode) => {
    const { document, getComputedStyle } = globalThis as unknown as Dom;
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const resolved = (value: string): string => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const status = new Set(
      ['--rr-ok', '--rr-warn', '--rr-bad']
        .map((token) => root.getPropertyValue(token).trim())
        .filter(Boolean)
        .map(resolved)
    );
    for (const name of ['success', 'warning', 'error']) {
      const rgb = root.getPropertyValue(`--v-theme-${name}`).trim();
      if (rgb) status.add(resolved(`rgb(${rgb})`));
    }
    probe.remove();

    const ICON = '.v-icon, .mdi, .v-progress-circular, svg';
    const visible = (el: El): boolean => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0
      );
    };
    const colourOf = (el: El): string => getComputedStyle(el).color;
    const ownText = (el: El): string =>
      [...el.childNodes]
        .filter((n) => n.nodeType === textNode)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
    const pseudoIcon = (el: El): boolean => {
      const content = getComputedStyle(el, '::before').content;
      return content !== 'none' && content !== 'normal' && content !== '""';
    };
    /** The row, line or small group an element is part of: where its icon or its words may be. */
    const context = (el: El): El => {
      const row = el.closest(
        '.rr-row, .v-alert, .v-btn, .v-chip, .v-list-item, .v-snackbar__wrapper, [role="status"], [role="alert"], tr, li'
      );
      if (row) return row;
      return el.parentElement?.parentElement ?? el.parentElement ?? el;
    };
    const words = (el: El): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const html = (el: El): string => el.outerHTML.replace(/\s+/g, ' ').slice(0, 200);

    const findings: { problem: 'no icon' | 'no words'; text: string; html: string }[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el) || !status.has(colourOf(el))) continue;
      if (el.matches(ICON)) {
        if (el.parentElement?.closest('.v-progress-circular')) continue;
        const named =
          el.getAttribute('aria-label') ??
          el.getAttribute('title') ??
          el.parentElement?.getAttribute('aria-label') ??
          el.parentElement?.getAttribute('title');
        if (!named && words(context(el)).length === 0) {
          findings.push({ problem: 'no words', text: '', html: html(el) });
        }
        continue;
      }
      const text = ownText(el);
      if (!text) continue;
      const box = context(el);
      // Its own icon, one inside it, or the icon of an ancestor drawn in the same colour.
      let iconed = pseudoIcon(el) || el.querySelector(ICON) !== null;
      for (let up = el.parentElement; up && !iconed; up = up.parentElement) {
        if (colourOf(up) === colourOf(el) && (pseudoIcon(up) || ownIcon(up))) iconed = true;
        if (up === box) break;
      }
      // Or an icon of the same colour in its row or line.
      if (!iconed) {
        iconed = [...box.querySelectorAll(ICON)].some(
          (icon) => visible(icon) && colourOf(icon) === colourOf(el)
        );
      }
      // A button or an alert says what it is with its own shape, label and icon.
      if (!iconed && box.matches('.v-btn, .v-alert, .v-snackbar__wrapper')) iconed = true;
      if (!iconed) findings.push({ problem: 'no icon', text: text.slice(0, 80), html: html(el) });
    }
    return findings;

    function ownIcon(el: El): boolean {
      return [...el.children].some((child) => child.matches(ICON));
    }
  }, TEXT_NODE);
}

/**
 * Every route the features declare (read from src/features/<name>/index.ts, so a new feature
 * is included without editing a list), with `:param` segments filled from `params` (keyed by
 * the declared route). A route with a parameter that has no value is returned in `unresolved`.
 */
export function featureRoutes(params: Record<string, string>): {
  routes: string[];
  unresolved: string[];
} {
  const features = path.join(repoRoot, 'src', 'features');
  const routes: string[] = [];
  const unresolved: string[] = [];
  for (const feature of readdirSync(features)) {
    let source: string;
    try {
      source = readFileSync(path.join(features, feature, 'index.ts'), 'utf8');
    } catch {
      continue;
    }
    let parent = '';
    for (const match of source.matchAll(/\bpath:\s*'([^']*)'/g)) {
      const declared = match[1]!;
      let route = declared;
      if (declared.startsWith('/')) parent = declared;
      else route = declared ? `${parent}/${declared}` : parent;
      if (!route.startsWith('/configure')) continue;
      const filled = route
        .split('/')
        .map((segment) => {
          if (!segment.startsWith(':')) return segment;
          const value = params[route];
          if (value !== undefined) return value;
          return segment.endsWith('?') ? '' : segment;
        })
        .filter((segment, index) => segment !== '' || index === 0)
        .join('/');
      if (filled.includes(':')) unresolved.push(route);
      else if (!routes.includes(filled)) routes.push(filled);
    }
  }
  return { routes, unresolved };
}
