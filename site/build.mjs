// Builds the rigready.io website into _site/.
//
//   node site/build.mjs                                 (from the repository root)
//   RELEASES_JSON=releases.json node site/build.mjs     (offline: GitHub's releases list from a file)
//
// Pages, all from site/layout.html:
//   /                 site/pages/home.html
//   /download/        site/pages/download.html: the newest release, how to run from source until
//                     there is one, and CHANGELOG.md
//   /download/latest/ a redirect to the newest installer (or to /download/ before there is one)
//   /docs/<old address>/  a redirect for a page of the manual that moved (MOVED_PAGES in
//                     lib/manual.mjs), so older links still land on it
//   /docs/            the manual's landing page (docs/manual/index.md) and a card per section
//   /docs/<section>/  a section's landing page (docs/manual/<section>/index.md) and a card per page
//   /docs/<section>/<page>/  one page of the manual (docs/manual/<section>/<page>.md)
//   /docs/contributing/  CONTRIBUTING.md
//   /docs/search.json    what the docs search box looks through (titles, sections, descriptions,
//                     headings), loaded by site/main.js the first time the box is used
//   /how-it-was-built/   site/pages/built.html: who did what, how it is checked, and what is not
//                     verified yet (the counts and the open requirements read from the ledger)
//
// So the site follows the project without anyone editing it: the downloads come from the
// published GitHub releases (drafts are ignored, and so is anything older than the major version
// in package.json: 1.x is a different app), and the changelog, manual and contributing pages are
// the repository's own documents. .github/workflows/site.yml runs this and publishes _site.
//
// Every page has what a search engine needs: a title, a description, a canonical URL and Open
// Graph tags (site/layout.html), and the manual's pages a BreadcrumbList; sitemap.xml and
// robots.txt list the whole site. The build fails on a page of the manual without front matter,
// a title or a description, a section folder without index.md, a link to a page of the manual
// that does not exist, and any link to a page or file of the site that was not built.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESCRIPTION_LENGTH,
  MANUAL_DIR,
  MANUAL_URL,
  breadcrumbs,
  buildManual,
  movedPages,
  redirectPage,
  repoPath,
  searchIndex,
  sidebarTree,
  siteLink,
  tidiedName,
} from './lib/manual.mjs';
import { esc, inline, render, sections, slugify } from './lib/markdown.mjs';
import { loadReleases, parseVersion, pickReleases } from './lib/releases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const REPO = 'MCheli/RigReady';
const REPO_URL = 'https://github.com/MCheli/rigready';
const DOMAIN = 'rigready.io';
/** What the manual is called in the sidebar and the breadcrumbs. */
const MANUAL_TITLE = 'Manual';
/** The end of every docs page's <title>. */
const DOCS_SUFFIX = ' - RigReady docs';

const read = (file) => readFile(path.join(ROOT, file), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const MAJOR = parseVersion(pkg.version).major;

/** Fills {{SLOTS}}. A slot the template names but the build does not fill is an error. */
function fill(template, slots, name) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
    if (!(key in slots)) throw new Error(`${name}: unknown slot ${m}`);
    return slots[key];
  });
}

const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;
const longDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

const ICON_DOWNLOAD =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_GITHUB =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';
const ICON_BOOK =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------------------------------------
// Releases

let releases;
try {
  releases = pickReleases(await loadReleases(REPO), MAJOR);
} catch (err) {
  // In CI a wrong answer ("not released yet" after a release) is worse than no deploy.
  if (process.env.CI) throw err;
  console.warn(`Could not read releases (${err.message}); building as if none were published.`);
  releases = { stable: null, beta: null, tags: new Map() };
}
const { stable, beta } = releases;

// ---------------------------------------------------------------------------------------------
// The manual: docs/manual/**, read here, put in order by lib/manual.mjs

async function manualFiles() {
  const dir = path.join(ROOT, MANUAL_DIR);
  const names = (await readdir(dir, { recursive: true })).filter((n) => n.endsWith('.md'));
  const files = new Map();
  for (const name of names.sort()) {
    files.set(name.split(path.sep).join('/'), await readFile(path.join(dir, name), 'utf8'));
  }
  return files;
}

const manual = buildManual(await manualFiles());
for (const p of manual.pages) {
  const n = p.description.length;
  if (n < DESCRIPTION_LENGTH.min || n > DESCRIPTION_LENGTH.max) {
    console.warn(
      `${MANUAL_DIR}/${p.file}: the description is ${n} characters; ${DESCRIPTION_LENGTH.min} to ${DESCRIPTION_LENGTH.max} reads best in search results`
    );
  }
}

/** Links written in a repository document -> the URLs the site uses (lib/manual.mjs). */
const docLink = (fromFile) => siteLink(fromFile, manual, REPO_URL);

// ---------------------------------------------------------------------------------------------
// The manual's pictures: tidied copies from site/tools/screens.py, else the raw capture

const guideImages = JSON.parse(await read('site/img/guide/index.json'));
const rawImages = []; // [source, target] copied after the output folder exists

function pngSize(file) {
  const b = readFileSync(file);
  return b.toString('ascii', 12, 16) === 'IHDR'
    ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    : null;
}

/** The HTML for a picture on its own line of `fromFile` (a repository path). */
function docImage(fromFile) {
  return (src, alt) => {
    const file = repoPath(fromFile, src);
    let url;
    let size;
    if (guideImages[file]) {
      url = `/img/guide/${guideImages[file].file}`;
      size = guideImages[file];
    } else {
      const source = path.join(ROOT, file);
      if (!existsSync(source)) throw new Error(`${fromFile}: picture not found: ${src}`);
      const name = tidiedName(file, path.extname(file));
      url = `/img/guide-raw/${name}`;
      size = pngSize(source);
      rawImages.push([source, path.join(OUT, 'img', 'guide-raw', name)]);
      console.warn(`${fromFile}: ${src} has no tidied copy; run python site/tools/screens.py`);
    }
    const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
    const tall = size && size.height > size.width ? ' tall' : '';
    return `<figure class="frame doc-figure${tall}"><button type="button" class="shot" data-lightbox><img src="${url}"${dims} loading="lazy" alt="${esc(alt)}" /></button><figcaption>${esc(alt)}</figcaption></figure>`;
  };
}

// ---------------------------------------------------------------------------------------------
// Pages

const layout = await read('site/layout.html');
const pages = []; // { path, html }

function nav(active) {
  const items = [
    ['/#features', 'Features', 'home'],
    [MANUAL_URL, 'Docs', 'docs'],
    [REPO_URL, 'GitHub', null],
  ];
  const links = items
    .map(
      ([href, label, key]) =>
        `<a href="${href}"${key === active && key !== 'home' ? ' aria-current="page"' : ''}>${label}</a>`
    )
    .join('');
  const current = active === 'download' ? ' aria-current="page"' : '';
  return `${links}<a class="nav-download" href="/download/"${current}>Download</a>`;
}

function page({ path: urlPath, page: kind, title, description, main, head = '' }) {
  const html = fill(
    layout,
    {
      TITLE: esc(title),
      DESCRIPTION: esc(description),
      PATH: urlPath,
      PAGE: kind,
      NAV: nav(kind),
      HEAD: head,
      MAIN: main,
      REPO_URL,
      YEAR: String(new Date().getUTCFullYear()),
    },
    'site/layout.html'
  );
  pages.push({ path: urlPath, html });
}

// Home --------------------------------------------------------------------------------------

const START = `${MANUAL_URL}getting-started/`;
const heroActions = stable
  ? `<a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download for Windows</a>
<a class="button" href="${MANUAL_URL}">${ICON_BOOK}Read the docs</a>
<p class="hero-note">Version ${esc(stable.version)}, ${megabytes(stable.installer.size)}, for Windows 10 and 11. Free and <a href="${REPO_URL}">open source</a>.</p>`
  : `<a class="button primary" href="/download/">${ICON_DOWNLOAD}Get version 2.0</a>
<a class="button" href="${MANUAL_URL}">${ICON_BOOK}Read the docs</a>
<p class="hero-note">Version 2.0 is in final testing; the installer is not published yet. Windows 10 and 11, free and <a href="${REPO_URL}">open source</a>.</p>`;

const getNote = stable
  ? `Version ${esc(stable.version)} for Windows 10 and 11, released ${longDate(stable.date)}. Free and open source.`
  : 'Version 2.0 is in final testing. The download page has where it stands and how to run it from source today.';
const getActions = stable
  ? `<a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download for Windows</a>
<a class="button" href="/download/">All downloads and the changelog</a>`
  : `<a class="button primary" href="/download/">${ICON_DOWNLOAD}Get version 2.0</a>
<a class="button" href="${START}">${ICON_BOOK}Getting started</a>`;

page({
  path: '/',
  page: 'home',
  title: 'RigReady: get the sim rig ready, keep your controls, find what is wrong',
  description:
    'A free, open-source Windows app for flight and racing sim rigs: it gets the rig ready and launches the game, keeps your bindings backed up, and shows what each controller does.',
  main: fill(
    await read('site/pages/home.html'),
    { HERO_ACTIONS: heroActions, GET_NOTE: getNote, GET_ACTIONS: getActions, REPO_URL },
    'site/pages/home.html'
  ),
});

// Download ----------------------------------------------------------------------------------

function changelog() {
  const doc = sections(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
  return doc.sections
    .map((s, i) => {
      const version = /^(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(s.title)?.[1];
      const page = version && releases.tags.get(`v${version}`);
      const link = page
        ? `<p><a class="release-link" href="${page}">Release on GitHub</a></p>`
        : '';
      return `<details class="version"${i === 0 ? ' open' : ''} id="v${slugify(version ?? s.title)}">
<summary><h3>${inline(s.title)}</h3></summary>
<div class="version-body">${link}
${render(s.body, { shift: 1, boldLineHeading: true, link: docLink('CHANGELOG.md') })}
</div>
</details>`;
    })
    .join('\n');
}

const betaLine = beta
  ? `<p>A beta of the next version is out: <a href="${beta.installer.url}">RigReady ${esc(beta.version)}</a> (${megabytes(beta.installer.size)}, <a href="${beta.page}">notes</a>). Installed copies get betas only on the beta channel.</p>`
  : '';

const releaseCard = stable
  ? `<div class="download-card">
<p class="download-version">RigReady ${esc(stable.version)}</p>
<p class="download-meta">Released ${longDate(stable.date)}. Installer, ${megabytes(stable.installer.size)}.</p>
<p><a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download ${esc(stable.installer.name)}</a></p>
<p class="small">Windows SmartScreen may warn the first time the installer runs, until it has earned a reputation with Microsoft: choose <em>More info</em>, then <em>Run anyway</em>. <a href="${stable.page}">Release notes</a> and every earlier version are on <a href="${REPO_URL}/releases">GitHub Releases</a>.</p>
</div>
${betaLine}`
  : `<div class="download-card">
<p class="download-version">Version 2.0 is almost here</p>
<p>RigReady 2.0 is a rebuild from the ground up, and it is being checked on real rigs before the first installer goes out. When it is published, the download appears on this page.</p>
<p>To hear about it, watch the repository on GitHub: <em>Watch</em>, then <em>Custom</em>, then <em>Releases</em>.</p>
<p><a class="button primary" href="${REPO_URL}">${ICON_GITHUB}Watch on GitHub</a></p>
</div>
${betaLine}
<p class="small">Version 1.1.0, the first RigReady, is still on <a href="${REPO_URL}/releases">GitHub Releases</a>. Version 2.0 replaces it and does not read its setups.</p>`;

const fromSource = `<section class="source" aria-labelledby="source-title">
  <div class="wrap narrow">
    <h2 id="source-title">${stable ? 'Build it from source' : 'Run it from source today'}</h2>
    <p>Windows 10 or 11 and Node.js 22.12 or newer. The last command runs the app on a recorded rig in a temporary folder; it changes nothing on your PC.</p>
<pre><code>git clone ${REPO_URL}.git
cd rigready
npm ci
npm run dev:scenario -- flying-all-good</code></pre>
    <p>To run it on your own rig: <code>npm run setup:python</code> once, then <code>npm run dev</code>. The <a href="/docs/contributing/">contributing guide</a> has the rest.</p>
  </div>
</section>`;

page({
  path: '/download/',
  page: 'download',
  title: 'Download RigReady',
  description: stable
    ? `Download RigReady ${stable.version} for Windows 10 and 11, and read what changed in each version.`
    : 'Where RigReady 2.0 stands, how to run it from source today, and what changed in each version.',
  main: fill(
    await read('site/pages/download.html'),
    { RELEASE: releaseCard, SOURCE: fromSource, CHANGELOG: changelog(), START, REPO_URL },
    'site/pages/download.html'
  ),
});

// How this was built ------------------------------------------------------------------------
//
// The requirement counts and the list of what is not verified yet are read from the ledger at
// build time, so the page cannot claim more than the ledger does. Security entries are left out
// of the list (the repository is public; open security work is not published).

function ledgerSummary() {
  const text = readFileSync(path.join(ROOT, 'docs/requirements/ledger.yaml'), 'utf8');
  const entries = text
    .split(/\n {2}- id: /)
    .slice(1)
    .map((chunk) => ({
      id: chunk.split(/\r?\n/)[0].trim(),
      title:
        /\n {4}title: (.+)/
          .exec(chunk)?.[1]
          .trim()
          .replace(/^['"]|['"]$/g, '') ?? '',
      status: /\n {4}status: (\w+)/.exec(chunk)?.[1] ?? 'todo',
    }));
  if (entries.length === 0) throw new Error('docs/requirements/ledger.yaml: no requirements read');
  const done = entries.filter((e) => e.status === 'done').length;
  const open = entries.filter((e) => e.status !== 'done' && !e.id.startsWith('SEC-'));
  const status = { in_progress: 'in progress', todo: 'to do' };
  return {
    total: String(entries.length),
    done: String(done),
    open: open.length
      ? `<ul class="facts">${open
          .map(
            (e) =>
              `<li><strong>${esc(e.title)}</strong> (${esc(e.id)}, ${status[e.status] ?? esc(e.status)})</li>`
          )
          .join('')}</ul>`
      : '<p>Every requirement in the ledger is done.</p>',
  };
}

const ledger = ledgerSummary();
page({
  path: '/how-it-was-built/',
  page: 'built',
  title: 'How RigReady was built',
  description:
    'RigReady is written with AI coding agents, as a side project by a professional software engineer. How the work was checked, what it was tested on, and what is not verified yet.',
  main: fill(
    await read('site/pages/built.html'),
    {
      LEDGER_TOTAL: ledger.total,
      LEDGER_DONE: ledger.done,
      LEDGER_OPEN: ledger.open,
      REPO_URL,
    },
    'site/pages/built.html'
  ),
});

// Docs: the manual, section by section, and the contributing guide --------------------------

const docsTemplate = await read('site/pages/docs.html');

/** The contents: every section of the manual with its pages (lib/manual.mjs), and the project's. */
function sidebar(currentFile) {
  const item = (href, label, key) =>
    `<li><a href="${href}"${key && key === currentFile ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  return `${sidebarTree(manual, currentFile, MANUAL_TITLE)}
<p class="docs-nav-title">Project</p>
<ul class="docs-list">${item('/docs/contributing/', 'Contributing', 'contributing')}${item('/download/#changelog', 'Changelog')}${item(`${REPO_URL}/tree/main/docs`, 'Developer documents')}</ul>`;
}

/** The trail above a page, and the same trail for search engines (schema.org BreadcrumbList). */
function crumbs(trail) {
  if (!trail || trail.length < 2) return { html: '', head: '' };
  const html = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail
    .map((c, i) =>
      i === trail.length - 1
        ? `<li aria-current="page">${esc(c.title)}</li>`
        : `<li><a href="${c.url}">${esc(c.title)}</a></li>`
    )
    .join('')}</ol></nav>`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.title,
      item: `https://${DOMAIN}${c.url}`,
    })),
  };
  const head = `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  return { html, head };
}

function pager(prev, next) {
  const a = (p, rel) =>
    p
      ? `<a class="pager-${rel}" href="${p.url}" rel="${rel}"><span>${rel === 'prev' ? 'Previous' : 'Next'}</span>${esc(p.title)}</a>`
      : '<span></span>';
  return `<nav class="pager" aria-label="Pages">${a(prev, 'prev')}${a(next, 'next')}</nav>`;
}

/** Cards for the pages of a section, or the sections of the manual. */
const cards = (items) =>
  `<ul class="cards">${items
    .map(
      (p) =>
        `<li><a href="${p.url}"><strong>${esc(p.title)}</strong><span class="summary">${esc(p.description)}</span></a></li>`
    )
    .join('')}</ul>`;

function docsPage({ path: urlPath, key, title, description, article, trail, prev, next, source }) {
  const crumb = crumbs(trail);
  page({
    path: urlPath,
    page: 'docs',
    title,
    description,
    head: crumb.head,
    main: fill(
      docsTemplate,
      {
        SIDEBAR: sidebar(key),
        CRUMBS: crumb.html,
        ARTICLE: article,
        PAGER: pager(prev, next),
        EDIT_URL: `${REPO_URL}/edit/main/${source}`,
      },
      'site/pages/docs.html'
    ),
  });
}

const contributing = {
  url: '/docs/contributing/',
  title: sections(await read('CONTRIBUTING.md')).title ?? 'Contributing',
};
/** The manual in reading order, then the contributing guide. */
const reading = [...manual.pages, contributing];

manual.pages.forEach((p, i) => {
  const source = `${MANUAL_DIR}/${p.file}`;
  const options = { link: docLink(source), image: docImage(source) };
  let article = `<h1>${esc(p.title)}</h1>\n${render(p.body, options)}`;
  if (p.file === 'index.md') {
    article += `\n${cards(manual.sections)}
<h2>For contributors</h2>
<p>The <a href="${contributing.url}">contributing guide</a> covers setup and the rules. The developer documents live with the code: <a href="${REPO_URL}/blob/main/docs/PRODUCT.md">what the product is</a>, <a href="${REPO_URL}/blob/main/docs/ARCHITECTURE.md">how it is put together</a>, <a href="${REPO_URL}/blob/main/docs/CONTRIBUTING-FEATURES.md">how to add a feature</a> and <a href="${REPO_URL}/blob/main/docs/requirements/ledger.yaml">every requirement with its evidence</a>.</p>`;
  } else if (p.isIndex) {
    article += `\n${cards(p.pages)}`;
  }
  docsPage({
    path: p.url,
    key: p.file,
    title: p.file === 'index.md' ? p.title : `${p.title}${DOCS_SUFFIX}`,
    description: p.description,
    source,
    trail: breadcrumbs(manual, p, MANUAL_TITLE),
    article,
    prev: reading[i - 1] ?? null,
    next: reading[i + 1] ?? null,
  });
});

docsPage({
  path: contributing.url,
  key: 'contributing',
  title: 'Contributing to RigReady',
  description:
    'How to set up RigReady for development, the rules a change follows, and how a pull request is checked.',
  source: 'CONTRIBUTING.md',
  trail: null,
  article: `<h1>${esc(contributing.title)}</h1>
${render(await read('CONTRIBUTING.md').then((md) => md.replace(/^#\s+.*\n/, '')), { link: docLink('CONTRIBUTING.md') })}`,
  prev: reading[reading.length - 2],
  next: null,
});

// /download/latest/: a stable link to the newest installer -----------------------------------

const latest = stable ? stable.installer.url : '/download/';
const redirect = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Download RigReady</title>
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${latest}">
<link rel="canonical" href="https://${DOMAIN}/download/"></head>
<body><p><a href="${latest}">Download RigReady</a></p></body></html>
`;

// ---------------------------------------------------------------------------------------------
// Write

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const item of ['style.css', 'main.js', 'favicon.svg', 'fonts', 'img']) {
  await cp(path.join(SITE, item), path.join(OUT, item), { recursive: true });
}
await rm(path.join(OUT, 'img', 'guide', 'index.json'));
for (const [source, target] of rawImages) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}
for (const p of pages) {
  const dir = path.join(OUT, ...p.path.split('/').filter(Boolean));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), p.html);
}
// The docs search (site/main.js) loads this the first time the search box is used.
const search = [
  ...searchIndex(manual, MANUAL_TITLE),
  {
    title: contributing.title,
    section: 'Project',
    description:
      'How to set up RigReady for development, the rules a change follows, and how a pull request is checked.',
    url: contributing.url,
    headings: [],
  },
];
await writeFile(path.join(OUT, 'docs', 'search.json'), JSON.stringify(search));
await mkdir(path.join(OUT, 'download', 'latest'), { recursive: true });
await writeFile(path.join(OUT, 'download', 'latest', 'index.html'), redirect);
// The old address of each page of the manual that moved sends the reader on to it.
const moved = movedPages(manual);
for (const page of moved) {
  const dir = path.join(OUT, ...page.path.split('/').filter(Boolean));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), redirectPage(page.to, page.title, DOMAIN));
}
await writeFile(path.join(OUT, 'CNAME'), `${DOMAIN}\n`);
await writeFile(
  path.join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: https://${DOMAIN}/sitemap.xml\n`
);
await writeFile(
  path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>https://${DOMAIN}${p.path}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);

// Every link to this site must land on a page or file that was built.
const broken = [];
for (const p of pages) {
  for (const [, href] of p.html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const file = path.join(OUT, href, href.endsWith('/') ? 'index.html' : '');
    if (!existsSync(file)) broken.push(`${p.path} -> ${href}`);
  }
}
if (broken.length) throw new Error(`Broken links:\n  ${broken.join('\n  ')}`);

console.log(
  `Built _site: ${pages.length} pages (${manual.sections.length} sections of the manual); ${stable ? `download ${stable.version} (${stable.installer.name})` : 'no release of this major version yet'}` +
    `${beta ? `, beta ${beta.version}` : ''}.`
);
