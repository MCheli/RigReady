/**
 * WOW-UI-005 to 007, on the source: the shared pieces of the final pass are used the way
 * they are meant, in every feature folder, whoever writes the page.
 *
 *  - A page that is still reading shows its outline (PageSkeleton), with words the page tour
 *    and a screen reader can read, never a line of text in an empty box.
 *  - An empty state (EmptyState) names a drawing that exists and says something.
 *  - The instrument detail (the brand mark, the heading tape) is drawn, not content, and is
 *    where it is meant to be and nowhere else.
 */
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

const src = path.join(repoRoot, 'src');
const relative = (file: string): string => path.relative(src, file).replace(/\\/g, '/');
const component = (name: string): string =>
  readFileSync(path.join(src, 'renderer', 'components', name), 'utf8');

async function vueFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await vueFiles(full)));
    } else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

interface AstNode {
  type: number;
  tag?: string;
  props?: {
    type: number;
    name: string;
    value?: { content: string };
    arg?: { content: string };
    exp?: { content: string };
  }[];
  children?: AstNode[];
  content?: string | { content: string };
}
const ELEMENT = 1;
const TEXT = 2;

const attr = (node: AstNode, name: string): string | undefined =>
  node.props?.find((p) => p.type === 6 && p.name === name)?.value?.content;
const bound = (node: AstNode, name: string): string | undefined =>
  node.props?.find((p) => p.type === 7 && p.name === 'bind' && p.arg?.content === name)?.exp
    ?.content;
const ownText = (node: AstNode): string =>
  (node.children ?? [])
    .filter((c) => c.type === TEXT)
    .map((c) => (typeof c.content === 'string' ? c.content : (c.content?.content ?? '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every element of one component's template. */
function elementsOf(source: string, file: string): { file: string; node: AstNode }[] {
  const found: { file: string; node: AstNode }[] = [];
  const { descriptor } = parse(source, { filename: file });
  const walk = (node: AstNode): void => {
    if (node.type === ELEMENT) found.push({ file, node });
    for (const child of node.children ?? []) walk(child);
  };
  if (descriptor.template?.ast) walk(descriptor.template.ast as unknown as AstNode);
  return found;
}

/** Every element of every template under src, with the file it is in. */
async function elements(): Promise<{ file: string; node: AstNode }[]> {
  const found: { file: string; node: AstNode }[] = [];
  for (const full of await vueFiles(src)) {
    found.push(...elementsOf(await fs.readFile(full, 'utf8'), relative(full)));
  }
  return found;
}

/** What a line that says "still loading" looks like: the page tour reads the same pattern. */
const LOADING = /^(Reading|Looking|Loading|Checking)[^.\n]*(…|\.\.\.)$/;

/**
 * Folders whose loading states are their own, each with its reason.
 */
const OWN_DESIGN: Record<string, string> = {
  'features/fly/':
    'The Fly screen is one design of its own: it says one word for the moment before the setup is read, and its checklist then draws itself item by item.',
};

/** The loading lines that stand as text in an empty box, each with what to do about it. */
function loadingLines(found: { file: string; node: AstNode }[]): string[] {
  const lines: string[] = [];
  for (const { file, node } of found) {
    if (!/\brr-empty\b/.test(attr(node, 'class') ?? '')) continue;
    if (!LOADING.test(ownText(node))) continue;
    if (Object.keys(OWN_DESIGN).some((folder) => file.startsWith(folder))) continue;
    lines.push(`${file}: "${ownText(node)}" (use <PageSkeleton label="${ownText(node)}" />)`);
  }
  return lines;
}

describe('WOW-UI-005 a page that is still reading shows its outline', () => {
  it('no page says it is loading with a line of text in an empty box', async () => {
    expect(loadingLines(await elements())).toEqual([]);
    for (const why of Object.values(OWN_DESIGN)) expect(why.length).toBeGreaterThan(40);
  });

  it('the scan sees such a line when there is one, and leaves an empty state alone', () => {
    const page = (inner: string): { file: string; node: AstNode }[] =>
      elementsOf(`<template><div class="rr-page">${inner}</div></template>`, 'features/x/X.vue');
    expect(loadingLines(page('<div class="rr-panel rr-empty">Reading the files…</div>'))).toEqual([
      'features/x/X.vue: "Reading the files…" (use <PageSkeleton label="Reading the files…" />)',
    ]);
    expect(
      loadingLines(page('<p v-if="!view" class="rr-empty">Looking for DCS...</p>'))
    ).toHaveLength(1);
    // Nothing there yet is not loading, and a sentence about reading is not a loading line.
    expect(loadingLines(page('<div class="rr-panel rr-empty">No backups yet.</div>'))).toEqual([]);
    expect(
      loadingLines(page('<div class="rr-empty">Reading a file takes a moment. Try again.</div>'))
    ).toEqual([]);
    // Progress said inside a row or a button is not a page waiting to be read.
    expect(loadingLines(page('<span class="rr-muted">Checking…</span>'))).toEqual([]);
    // A folder with a design of its own is left to it.
    expect(
      loadingLines(
        elementsOf(
          '<template><div class="rr-empty">Loading…</div></template>',
          'features/fly/renderer/FlyPage.vue'
        )
      )
    ).toEqual([]);
  });

  it('every outline says what is being read, in words that end with an ellipsis', async () => {
    const used = (await elements()).filter(({ node }) => node.tag === 'PageSkeleton');
    // The pages that used to show a line of text.
    expect(used.length).toBeGreaterThanOrEqual(18);
    const wrong = used
      .filter(({ node }) => !LOADING.test(attr(node, 'label') ?? ''))
      .map(({ file, node }) => `${file}: label="${attr(node, 'label') ?? bound(node, 'label')}"`);
    expect(wrong).toEqual([]);
    const features = new Set(used.map(({ file }) => file.split('/')[1]));
    expect(features.size).toBeGreaterThanOrEqual(10);
  });

  it('the outline is a status region marked busy, with its words on the page and its bars hidden', () => {
    const { descriptor } = parse(component('PageSkeleton.vue'), { filename: 'PageSkeleton.vue' });
    const root = (descriptor.template!.ast as unknown as AstNode).children!.find(
      (c) => c.type === ELEMENT
    )!;
    expect(attr(root, 'role')).toBe('status');
    expect(attr(root, 'aria-busy')).toBe('true');
    // What the whole-app specs look for as "still loading" (their BUSY selector).
    expect(attr(root, 'class')).toMatch(/\bv-skeleton-loader\b/);
    const [words, ...rest] = root.children!.filter((c) => c.type === ELEMENT);
    expect(attr(words!, 'class')).toBe('rr-sr-only');
    expect(rest.length).toBeGreaterThan(0);
    for (const drawn of rest) expect(attr(drawn, 'aria-hidden')).toBe('true');
    // It waits before it fades in, on the motion tokens, and holds still on request.
    const style = descriptor.styles.map((s) => s.content).join('\n');
    expect(style).toMatch(
      /animation:\s*rr-skeleton-in var\(--rr-motion-base\) var\(--rr-ease\) var\(--rr-motion-fast\) both/
    );
    expect(style).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation:\s*none/);
  });
});

describe('WOW-UI-006 empty states look the same everywhere', () => {
  const art = component('EmptyArt.vue');
  const names = [
    .../export type EmptyArtName =([^;]+);/.exec(art)![1]!.matchAll(/'([a-z]+)'/g),
  ].map((m) => m[1]!);

  it('every drawing an empty state names exists, and every empty state says something', async () => {
    expect(names).toEqual(expect.arrayContaining(['nothing', 'search', 'backup', 'shield']));
    const used = (await elements()).filter(({ node }) => node.tag === 'EmptyState');
    expect(used.length).toBeGreaterThanOrEqual(7);
    const wrong: string[] = [];
    for (const { file, node } of used) {
      const name = attr(node, 'art');
      if (name !== undefined && !names.includes(name)) wrong.push(`${file}: art="${name}"`);
      const title = attr(node, 'title') ?? bound(node, 'title');
      const says = (node.children ?? []).some((c) => c.type !== ELEMENT || c.tag !== 'template');
      if (!title && !says) wrong.push(`${file}: an empty state without a title or a sentence`);
      // Nothing is wrong when something is not there: never a status colour.
      if (/\brr-(ok|warn|bad)\b/.test(attr(node, 'class') ?? '')) {
        wrong.push(`${file}: an empty state in a status colour`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('each drawing is drawn: a branch in the template for every name but the plain one', () => {
    for (const name of names.filter((n) => n !== 'nothing')) {
      expect(art, name).toContain(`name === '${name}'`);
    }
    // Decorative: hidden from a screen reader, and never a tab stop.
    expect(art).toMatch(/aria-hidden="true"/);
    expect(art).toMatch(/focusable="false"/);
  });

  it('"not on this PC" and "nothing at this address" use the same drawing and component', () => {
    expect(component('NotOnThisPc.vue')).toMatch(/<EmptyArt v-else name="search"/);
    const notFound = readFileSync(path.join(src, 'renderer', 'layouts', 'NotFound.vue'), 'utf8');
    expect(notFound).toMatch(/<EmptyState art="search" title="There is nothing at this address\."/);
  });

  it('a panel that only says it in words gets the plain drawing, unless it has a status or an icon of its own', () => {
    const css = readFileSync(path.join(src, 'renderer', 'styles.css'), 'utf8').replace(/\s+/g, ' ');
    const rule =
      /\.rr-panel\.rr-empty:not\(\.rr-empty-state, \.rr-ok, \.rr-warn, \.rr-bad\):not\( :has\(\.v-icon, svg, \.v-progress-circular\) \)::before \{([^}]*)\}/.exec(
        css
      );
    expect(rule, 'the rule for a plain empty panel').not.toBeNull();
    expect(rule![1]).toMatch(/mask: url\("data:image\/svg\+xml,/);
    expect(rule![1]).toMatch(/background-color: var\(--rr-border-strong\)/);
  });
});

describe('WOW-UI-007 one instrument detail', () => {
  it('the brand mark is a drawing with two shapes, hidden from a screen reader', () => {
    const mark = component('BrandMark.vue');
    expect(mark).toMatch(/aria-hidden="true"/);
    expect(mark).toMatch(/focusable="false"/);
    expect(mark).toMatch(/v-if="kind === 'racing'"/);
    expect(mark).toMatch(/stroke="currentColor"/);
    // Its colour is the accent, or the one that follows the setup's kind of game.
    expect(mark).toMatch(/color: var\(--rr-kind, var\(--rr-accent\)\)/);
  });

  it('the heading tape is drawn by the header and the About panel only, and is not content', async () => {
    const tape = /linear-gradient\(90deg, var\(--rr-border-strong\) 1px, transparent 1px\)/;
    const users: string[] = [];
    for (const full of await vueFiles(src)) {
      if (tape.test(await fs.readFile(full, 'utf8'))) users.push(relative(full));
    }
    expect(users.sort()).toEqual(['renderer/App.vue', 'renderer/components/AboutDialog.vue']);
    for (const file of users) {
      const text = readFileSync(path.join(src, file), 'utf8').replace(/\s+/g, ' ');
      // A pseudo-element with no words in it, that takes no click.
      const rule = /::after \{ content: ''; position: absolute;[^}]*\}/.exec(text);
      expect(rule, file).not.toBeNull();
      expect(rule![0]).toMatch(/pointer-events: none/);
      expect(rule![0]).toMatch(/mask-image: linear-gradient/);
    }
  });
});
