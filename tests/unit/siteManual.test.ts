import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_LENGTH,
  MOVED_PAGES,
  breadcrumbs,
  buildManual,
  manualUrl,
  movedPages,
  pageHeadings,
  pageOf,
  parseFrontMatter,
  redirectPage,
  repoPath,
  searchIndex,
  sidebarTree,
  siteLink,
  tidiedName,
} from '../../site/lib/manual.mjs';
import { repoRoot } from '../helpers';

/**
 * The website's manual (docs/manual, built by site/build.mjs): the pure parts in
 * site/lib/manual.mjs, and the manual as it is in the repository.
 */

const REPO_URL = 'https://github.com/MCheli/rigready';
const page = (title: string, order?: number, body = ''): string =>
  `---\ntitle: ${title}\ndescription: ${title}, described in one sentence that is long enough to pass for a meta description of the page.\n${order === undefined ? '' : `order: ${order}\n`}---\n${body}`;

describe('front matter', () => {
  it('reads key: value lines between the --- lines, with or without quotes', () => {
    const { data, body } = parseFrontMatter(
      "---\ntitle: \"Make: ready\"\ndescription: 'It''s short'\norder: 20\n---\n\nThe body.\n"
    );
    expect(data).toEqual({ title: 'Make: ready', description: "It's short", order: '20' });
    expect(body).toBe('\nThe body.\n');
  });

  it('is required, and so are the title and the description', () => {
    expect(() => parseFrontMatter('# Title\n\nNo front matter.', 'x.md')).toThrow(
      /no front matter/
    );
    expect(() => pageOf('a/b.md', '---\ndescription: one\n---\n')).toThrow(/no title/);
    expect(() => pageOf('a/b.md', '---\ntitle: one\n---\n')).toThrow(/no description/);
    expect(() => pageOf('a/b.md', page('T', 1, '# Not here\n'))).toThrow(/"#" heading/);
    expect(() => pageOf('a/b.md', page('T', 1, '```\n# in code is fine\n```\n'))).not.toThrow();
  });
});

describe('urls and slugs', () => {
  it('maps files to site paths', () => {
    expect(manualUrl('index.md')).toBe('/docs/');
    expect(manualUrl('getting-started/index.md')).toBe('/docs/getting-started/');
    expect(manualUrl('getting-started/first-setup.md')).toBe('/docs/getting-started/first-setup/');
  });

  it('refuses names that are not slugs and pages deeper than one section', () => {
    expect(() => manualUrl('Getting Started/x.md')).toThrow(/not a slug/);
    expect(() => manualUrl('a/b/c.md')).toThrow(/one level deep/);
    expect(() => manualUrl('a/b.txt')).toThrow(/one level deep/);
  });
});

describe('the manual', () => {
  const files = new Map([
    ['index.md', page('RigReady manual', 0)],
    ['play/index.md', page('Play', 20)],
    ['play/make-ready.md', page('Make ready', 20)],
    ['play/before-you-fly.md', page('Before you fly', 10)],
    ['play/zebra.md', page('Unordered')],
    ['getting-started/index.md', page('Getting started', 10)],
    ['getting-started/install.md', page('Install', 10)],
  ]);

  it('orders the sections and their pages by order, then by slug', () => {
    const manual = buildManual(files);
    expect(manual.sections.map((s) => s.slug)).toEqual(['getting-started', 'play']);
    expect(manual.sections[1]!.pages.map((p) => p.slug)).toEqual([
      'before-you-fly',
      'make-ready',
      'zebra',
    ]);
    expect(manual.pages.map((p) => p.url)).toEqual([
      '/docs/',
      '/docs/getting-started/',
      '/docs/getting-started/install/',
      '/docs/play/',
      '/docs/play/before-you-fly/',
      '/docs/play/make-ready/',
      '/docs/play/zebra/',
    ]);
  });

  it('needs a landing page and an index.md in every section folder', () => {
    expect(() => buildManual([['play/index.md', page('Play', 1)]])).toThrow(/index\.md is missing/);
    expect(() =>
      buildManual([
        ['index.md', page('M', 0)],
        ['play/make-ready.md', page('P', 1)],
      ])
    ).toThrow(/play\/ has no index\.md/);
    expect(() =>
      buildManual([
        ['index.md', page('M', 0)],
        ['stray.md', page('S', 1)],
      ])
    ).toThrow(/belongs in a section folder/);
  });

  it('makes the breadcrumbs from the landing page down', () => {
    const manual = buildManual(files);
    expect(breadcrumbs(manual, manual.landing)).toEqual([{ title: 'Manual', url: '/docs/' }]);
    expect(breadcrumbs(manual, manual.sections[1]!).map((c) => c.title)).toEqual([
      'Manual',
      'Play',
    ]);
    expect(breadcrumbs(manual, manual.sections[1]!.pages[1]!, 'Docs')).toEqual([
      { title: 'Docs', url: '/docs/' },
      { title: 'Play', url: '/docs/play/' },
      { title: 'Make ready', url: '/docs/play/make-ready/' },
    ]);
  });

  it('rewrites links between pages, to the project documents and to other files', () => {
    const manual = buildManual(files);
    const link = siteLink('docs/manual/getting-started/install.md', manual, REPO_URL);
    expect(link('../play/make-ready.md')).toBe('/docs/play/make-ready/');
    expect(link('../play/make-ready.md#steps')).toBe('/docs/play/make-ready/#steps');
    expect(link('../play/index.md')).toBe('/docs/play/');
    expect(link('../play/')).toBe('/docs/play/');
    expect(link('../index.md')).toBe('/docs/');
    expect(link('index.md')).toBe('/docs/getting-started/');
    expect(link('../../../CONTRIBUTING.md#setup')).toBe('/docs/contributing/#setup');
    expect(link('../../../CHANGELOG.md')).toBe('/download/#changelog');
    expect(link('../../USER-GUIDE.md')).toBe('/docs/');
    expect(link('../../PRODUCT.md')).toBe(`${REPO_URL}/blob/main/docs/PRODUCT.md`);
    expect(link('https://rigready.io/download/')).toBe('https://rigready.io/download/');
    expect(link('#here')).toBe('#here');
    expect(() => link('../play/nowhere.md')).toThrow(/does not exist: \.\.\/play\/nowhere\.md/);
    expect(() => link('../lost/index.md')).toThrow(/does not exist/);
  });

  it('keeps the old address of a page that moved, sending the reader on to it', () => {
    const manual = buildManual(files);
    expect(movedPages(manual, { 'getting-started/make-ready.md': 'play/make-ready.md' })).toEqual([
      {
        path: '/docs/getting-started/make-ready/',
        to: '/docs/play/make-ready/',
        title: 'Make ready',
      },
    ]);
    // A page that is still there did not move; one that moved must land somewhere.
    expect(() => movedPages(manual, { 'play/make-ready.md': 'play/zebra.md' })).toThrow(
      /still there/
    );
    expect(() => movedPages(manual, { 'play/gone.md': 'play/nowhere.md' })).toThrow(
      /does not exist/
    );
    const html = redirectPage('/docs/play/make-ready/', 'Make <ready>', 'rigready.io');
    // At once, with the section of the page the old link pointed at, and without script too.
    expect(html).toContain('location.replace("/docs/play/make-ready/" + location.hash)');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/docs/play/make-ready/">');
    expect(html).toContain('<a href="/docs/play/make-ready/">Make &lt;ready&gt;</a>');
    // Search engines are told where the page is now, and not to list the old address.
    expect(html).toContain(
      '<link rel="canonical" href="https://rigready.io/docs/play/make-ready/">'
    );
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('names pictures and resolves their paths', () => {
    expect(
      repoPath('docs/manual/play/make-ready.md', '../../../artifacts/screens/fly-rig/01.png')
    ).toBe('artifacts/screens/fly-rig/01.png');
    expect(tidiedName('artifacts/screens/fly-rig/01-problems.png')).toBe(
      'fly-rig--01-problems.webp'
    );
    expect(tidiedName('artifacts/screens/fly-rig/01-problems.png', '.png')).toBe(
      'fly-rig--01-problems.png'
    );
  });
});

describe('docs/manual as it is', () => {
  const dir = path.join(repoRoot, 'docs', 'manual');

  async function read(): Promise<Map<string, string>> {
    const names = (await fs.readdir(dir, { recursive: true })).filter((n) => n.endsWith('.md'));
    const files = new Map<string, string>();
    for (const name of names.sort()) {
      files.set(name.split(path.sep).join('/'), await fs.readFile(path.join(dir, name), 'utf8'));
    }
    return files;
  }

  it('has a landing page, a Getting started section, and front matter the site build accepts', async () => {
    const manual = buildManual(await read());
    expect(manual.sections.map((s) => s.slug)).toContain('getting-started');
    for (const p of manual.pages) {
      expect(p.description, p.file).not.toMatch(/[`*\[]/);
      expect(p.description.length, `${p.file}: description length`).toBeGreaterThanOrEqual(
        DESCRIPTION_LENGTH.min
      );
      expect(p.description.length, `${p.file}: description length`).toBeLessThanOrEqual(
        DESCRIPTION_LENGTH.max
      );
    }
  });

  it('links only to pages and pictures that exist', async () => {
    const manual = buildManual(await read());
    for (const p of manual.pages) {
      const from = `docs/manual/${p.file}`;
      const link = siteLink(from, manual, REPO_URL);
      for (const m of p.body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1]!;
        expect(() => link(href), `${from} -> ${href}`).not.toThrow();
        const target = link(href);
        if (target.startsWith(`${REPO_URL}/blob/main/`)) {
          const file = target.slice(`${REPO_URL}/blob/main/`.length).split('#')[0]!;
          expect(existsSync(path.join(repoRoot, file)), `${from} -> ${href}`).toBe(true);
        }
      }
      for (const m of p.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const src = m[1]!;
        expect(existsSync(path.join(repoRoot, repoPath(from, src))), `${from} -> ${src}`).toBe(
          true
        );
      }
    }
  });

  it('lists every page in the sidebar of every page, the current one marked', async () => {
    const manual = buildManual(await read());
    for (const here of manual.pages) {
      const html = sidebarTree(manual, here.file);
      for (const p of manual.pages) {
        expect(html, `${here.file} -> ${p.url}`).toContain(`href="${p.url}"`);
      }
      expect(html.match(/aria-current="page"/g), here.file).toHaveLength(1);
      expect(html, here.file).toContain(`<a href="${here.url}" aria-current="page">`);
      // One fold-out group per section; only the current page's section is open.
      expect(html.match(/<details/g)).toHaveLength(manual.sections.length);
      expect(html.match(/<details open>/g) ?? [], here.file).toHaveLength(here.section ? 1 : 0);
    }
  });

  it('puts every page in the search index, with its section', async () => {
    const manual = buildManual(await read());
    const index = searchIndex(manual);
    expect(index.map((e) => e.url)).toEqual(manual.pages.map((p) => p.url));
    for (const e of index) {
      expect(e.title, e.url).toBeTruthy();
      expect(e.section, e.url).toBeTruthy();
      expect(e.description, e.url).toBeTruthy();
    }
    expect(index.find((e) => e.url === '/docs/dcs/kneeboard/')?.section).toBe('DCS World');
  });

  it('has the cheat sheets and the trainer under Controls, not under one game, and their old addresses still lead there', async () => {
    const manual = buildManual(await read());
    const index = searchIndex(manual);
    for (const url of ['/docs/controls/cheat-sheets/', '/docs/controls/trainer/']) {
      expect(index.find((e) => e.url === url)?.section, url).toBe('Controls');
    }
    expect(movedPages(manual)).toEqual([
      {
        path: '/docs/dcs/cheat-sheets/',
        to: '/docs/controls/cheat-sheets/',
        title: 'Cheat sheets',
      },
      {
        path: '/docs/dcs/trainer/',
        to: '/docs/controls/trainer/',
        title: 'Learn your controls (the trainer)',
      },
    ]);
    expect(Object.keys(MOVED_PAGES)).toEqual(['dcs/cheat-sheets.md', 'dcs/trainer.md']);
  });
});

describe('docs search headings', () => {
  it('reads the headings outside code, with the ids the renderer gives them', () => {
    const body =
      '## The `Play` screen\n\n```\n## not this\n```\n### A [link](x.md) here\n#### too deep\n';
    expect(pageHeadings(body)).toEqual([
      { text: 'The Play screen', id: 'the-play-screen' },
      { text: 'A link here', id: 'a-link-x-md-here' },
    ]);
  });
});
