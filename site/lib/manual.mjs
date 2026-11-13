// The manual: docs/manual/**. Sections are folders, pages are .md files, every file starts with
// front matter (title, description, order). These are the pure parts of building it, shared by
// site/build.mjs and tests/unit/siteManual.test.ts: no file system, no dependencies. build.mjs
// reads the files and renders the pages.

import path from 'node:path';
import { esc, slugify } from './markdown.mjs';

/** Where the manual lives in the repository. */
export const MANUAL_DIR = 'docs/manual';
/** Where it is on the site. */
export const MANUAL_URL = '/docs/';
/** A page without an order sorts after every page that has one. */
const UNORDERED = 1000;
/** The length a description should have: search engines show about this much of it. */
export const DESCRIPTION_LENGTH = { min: 90, max: 160 };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The value of a front matter line, without the quotes YAML allows around it. */
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Splits a page into its front matter and its body. The front matter is the block between two
 * "---" lines at the top of the file, one "key: value" per line; a value may be quoted. Throws
 * when there is none: every page of the manual has one.
 */
export function parseFrontMatter(text, file = 'page') {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(String(text));
  if (!m) throw new Error(`${file}: no front matter (a "---" block with title and description)`);
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line.trimEnd());
    if (!kv) throw new Error(`${file}: front matter line is not "key: value": ${line.trim()}`);
    data[kv[1]] = unquote((kv[2] ?? '').trim());
  }
  return { data, body: m[2] };
}

/** "getting-started/install.md" -> "/docs/getting-started/install/"; "index.md" -> "/docs/". */
export function manualUrl(file) {
  const parts = file.split('/');
  if (parts.length > 2 || !file.endsWith('.md')) {
    throw new Error(`${MANUAL_DIR}/${file}: pages are <section>/<page>.md, one level deep`);
  }
  const names = parts.map((p) => p.replace(/\.md$/, ''));
  if (parts.length === 2 && names[0] === 'index') {
    throw new Error(`${MANUAL_DIR}/${file}: a section cannot be called index`);
  }
  for (const name of names) {
    if (name !== 'index' && !SLUG.test(name)) {
      throw new Error(`${MANUAL_DIR}/${file}: "${name}" is not a slug (a-z, 0-9 and hyphens)`);
    }
  }
  const kept = names.filter((n) => n !== 'index');
  return kept.length ? `${MANUAL_URL}${kept.join('/')}/` : MANUAL_URL;
}

/** Whether a body has a top-level heading outside fenced code: the title already is the h1. */
function hasH1(body) {
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#\s/.test(line)) return true;
  }
  return false;
}

/**
 * One page of the manual from its file (relative to docs/manual, with "/") and its text.
 * Throws on a missing front matter, title or description, or an h1 in the body.
 */
export function pageOf(file, text) {
  const name = `${MANUAL_DIR}/${file}`;
  const url = manualUrl(file);
  const { data, body } = parseFrontMatter(text, name);
  if (!data.title) throw new Error(`${name}: front matter has no title`);
  if (!data.description) throw new Error(`${name}: front matter has no description`);
  const order = data.order === undefined || data.order === '' ? UNORDERED : Number(data.order);
  if (!Number.isFinite(order)) throw new Error(`${name}: order is not a number: ${data.order}`);
  if (hasH1(body)) throw new Error(`${name}: the body has a "#" heading; the title is the h1`);
  const slug = path.posix.basename(file, '.md');
  const section = file.includes('/') ? file.split('/')[0] : null;
  return {
    file,
    url,
    slug,
    section,
    isIndex: slug === 'index',
    title: data.title,
    description: data.description,
    order,
    body,
  };
}

const byOrder = (a, b) => a.order - b.order || a.slug.localeCompare(b.slug);

/**
 * The manual from its files: a Map or an array of [file, text], one entry per .md file under
 * docs/manual, the file relative to that folder. Returns the landing page, the sections in
 * order (each with its pages in order), every page in reading order, and a lookup by file. A
 * section folder that exists must have an index.md; a folder that does not exist is absent.
 */
export function buildManual(files) {
  const entries = [...(files instanceof Map ? files.entries() : files)];
  const pages = entries.map(([file, text]) => pageOf(file.split(path.sep).join('/'), text));
  const landing = pages.find((p) => p.file === 'index.md');
  if (!landing) throw new Error(`${MANUAL_DIR}/index.md is missing`);
  const stray = pages.find((p) => p.section === null && !p.isIndex);
  if (stray) throw new Error(`${MANUAL_DIR}/${stray.file}: a page belongs in a section folder`);
  const folders = [...new Set(pages.filter((p) => p.section).map((p) => p.section))];
  const sections = folders
    .map((folder) => {
      const own = pages.filter((p) => p.section === folder);
      const index = own.find((p) => p.isIndex);
      if (!index) throw new Error(`${MANUAL_DIR}/${folder}/ has no index.md`);
      return { ...index, slug: folder, pages: own.filter((p) => !p.isIndex).sort(byOrder) };
    })
    .sort(byOrder);
  const reading = [landing, ...sections.flatMap((s) => [s, ...s.pages])];
  return { landing, sections, pages: reading, byFile: new Map(reading.map((p) => [p.file, p])) };
}

/**
 * Pages of the manual that moved, the old file -> the new one (relative to docs/manual). The site
 * keeps each old address as a page that sends the reader on, so a link from an older RigReady, a
 * bookmark or a search result still lands on the page. Links inside the repository name the new
 * file; a link to the old one fails the build like any link to a page that does not exist.
 */
export const MOVED_PAGES = {
  // Both work for the racing games too (12 Nov 2026): out of the DCS World section.
  'dcs/cheat-sheets.md': 'controls/cheat-sheets.md',
  'dcs/trainer.md': 'controls/trainer.md',
};

/**
 * The old addresses of the pages that moved, each with the address and title of the page it
 * moved to. Throws when an old page is still there, or the page it moved to is not.
 */
export function movedPages(manual, moved = MOVED_PAGES) {
  return Object.entries(moved).map(([from, to]) => {
    if (manual.byFile.has(from)) {
      throw new Error(`${MANUAL_DIR}/${from} moved to ${to}, but it is still there`);
    }
    const page = manual.byFile.get(to);
    if (!page) throw new Error(`${MANUAL_DIR}/${from} moved to ${to}, which does not exist`);
    return { path: manualUrl(from), to: page.url, title: page.title };
  });
}

/**
 * The page at an old address: it sends the reader on at once, keeping the part after "#" (a
 * section of the page), names the new address for search engines, and is a link without script.
 */
export function redirectPage(to, title, domain) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="robots" content="noindex"><link rel="canonical" href="https://${domain}${to}">
<script>location.replace(${JSON.stringify(to)} + location.hash);</script>
<meta http-equiv="refresh" content="0; url=${to}"></head>
<body><p>This page moved: <a href="${to}">${esc(title)}</a></p></body></html>
`;
}

/** The trail from the manual's landing page to a page: [{ title, url }, ...]. */
export function breadcrumbs(manual, page, rootTitle = 'Manual') {
  const trail = [{ title: rootTitle, url: manual.landing.url }];
  if (page.file === 'index.md') return trail;
  const section = manual.sections.find((s) => s.slug === page.section);
  trail.push({ title: section.title, url: section.url });
  if (!page.isIndex) trail.push({ title: page.title, url: page.url });
  return trail;
}

/** A path written in a document, relative to that document, as a repository path. */
export function repoPath(fromFile, href) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), href));
}

/**
 * A link target as written in `fromFile` (a repository path) -> the URL the site uses: manual
 * pages (and section folders) become their pages, CONTRIBUTING.md and CHANGELOG.md their pages,
 * any other repository file its page on GitHub. Web links, mail links and "#" links pass
 * through. A link to a manual page that does not exist is an error.
 */
export function siteLink(fromFile, manual, repoUrl) {
  return (href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const [file, hash] = href.split('#');
    const target = repoPath(fromFile, file);
    const anchor = hash ? `#${hash}` : '';
    if (target === MANUAL_DIR || target.startsWith(`${MANUAL_DIR}/`)) {
      const inside = target.slice(MANUAL_DIR.length + 1);
      if (inside === '') return MANUAL_URL + anchor;
      const page = manual.byFile.get(inside);
      if (page) return page.url + anchor;
      const section = manual.sections.find((s) => s.slug === inside.replace(/\/$/, ''));
      if (section) return section.url + anchor;
      throw new Error(`${fromFile}: link to a manual page that does not exist: ${href}`);
    }
    const pages = {
      'docs/USER-GUIDE.md': MANUAL_URL,
      'CONTRIBUTING.md': '/docs/contributing/',
      'CHANGELOG.md': '/download/#changelog',
    };
    if (pages[target]) return pages[target] + (pages[target].includes('#') ? '' : anchor);
    return `${repoUrl}/blob/main/${target}${anchor}`;
  };
}

/**
 * The "##" and "###" headings of a page body outside fenced code, as the reader sees them (the
 * inline markdown taken out), with the id the renderer gives them (lib/markdown.mjs).
 */
export function pageHeadings(body) {
  const out = [];
  let fenced = false;
  for (const line of String(body).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const m = !fenced && /^#{2,3}\s+(.*)$/.exec(line.trimEnd());
    if (!m) continue;
    const text = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, '')
      .trim();
    if (text) out.push({ text, id: slugify(m[1]) });
  }
  return out;
}

/**
 * What the docs search looks through, one entry per page of the manual in reading order: its
 * title, its section's title, its description, its URL and its headings ([text, id] pairs).
 * The build writes it to /docs/search.json; a docs page loads it when the search box is used.
 */
export function searchIndex(manual, rootTitle = 'Manual') {
  const sectionTitle = new Map(manual.sections.map((s) => [s.slug, s.title]));
  return manual.pages.map((p) => ({
    title: p.title,
    section: p.section ? sectionTitle.get(p.section) : rootTitle,
    description: p.description,
    url: p.url,
    headings: pageHeadings(p.body).map((h) => [h.text, h.id]),
  }));
}

/**
 * The manual in the docs sidebar: every section as a fold-out group (<details>) of its pages,
 * with the section's own page linked from the summary. The section of the current page is open
 * and the current page is marked (aria-current). Works without JavaScript.
 */
export function sidebarTree(manual, currentFile, rootTitle = 'Manual') {
  const a = (p, current) =>
    `<a href="${p.url}"${current ? ` aria-current="${current}"` : ''}>${esc(p.title)}</a>`;
  const openSection = currentFile?.includes('/') ? currentFile.split('/')[0] : null;
  const tree = manual.sections
    .map((s) => {
      const open = s.slug === openSection;
      const current = s.file === currentFile ? 'page' : open ? 'location' : '';
      const pages = s.pages
        .map((p) => `<li>${a(p, p.file === currentFile ? 'page' : '')}</li>`)
        .join('');
      return `<li${open ? ' class="open"' : ''}><details${open ? ' open' : ''}><summary>${a(s, current)}<span class="docs-twist" aria-hidden="true"></span></summary><ul>${pages}</ul></details></li>`;
    })
    .join('');
  const home = currentFile === 'index.md' ? ' aria-current="page"' : '';
  return `<p class="docs-nav-title"><a href="${MANUAL_URL}"${home}>${esc(rootTitle)}</a></p>
<ul class="docs-tree">${tree}</ul>`;
}

/**
 * The name of a picture's tidied copy: artifacts/screens/<folder>/<file>.png ->
 * <folder>--<file>.webp (site/tools/screens.py names them the same way).
 */
export function tidiedName(repoFile, ext = '.webp') {
  const inside = repoFile.replace(/^artifacts\/screens\//, '');
  return (
    inside
      .replace(/\.[a-z0-9]+$/i, '')
      .split('/')
      .join('--') + ext
  );
}
