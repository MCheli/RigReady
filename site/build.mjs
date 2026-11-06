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
//   /docs/            the user guide's introduction and its chapters (docs/USER-GUIDE.md)
//   /docs/<chapter>/  one page per "##" chapter of the guide, named after its heading
//   /docs/contributing/  CONTRIBUTING.md
//
// So the site follows the project without anyone editing it: the downloads come from the
// published GitHub releases (drafts are ignored, and so is anything older than the major version
// in package.json: 1.x is a different app), and the changelog, guide and contributing pages are
// the repository's own documents. .github/workflows/site.yml runs this and publishes _site.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, inline, render, sections, slugify, summary } from './lib/markdown.mjs';
import { loadReleases, parseVersion, pickReleases } from './lib/releases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const REPO = 'MCheli/RigReady';
const REPO_URL = 'https://github.com/MCheli/rigready';
const DOMAIN = 'rigready.io';

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
// Links between the repository's documents become links between pages

/** A link target as written in `fromFile` (a repository path) -> the URL the site uses. */
function docLink(fromFile) {
  return (href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const [file, hash] = href.split('#');
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), file));
    const pages = {
      'docs/USER-GUIDE.md': '/docs/',
      'CONTRIBUTING.md': '/docs/contributing/',
      'CHANGELOG.md': '/download/#changelog',
    };
    if (pages[target])
      return pages[target] + (hash && !pages[target].includes('#') ? `#${hash}` : '');
    return `${REPO_URL}/blob/main/${target}${hash ? `#${hash}` : ''}`;
  };
}

// ---------------------------------------------------------------------------------------------
// The guide's pictures: tidied copies from site/tools/screens.py, else the raw capture

const guideImages = JSON.parse(await read('site/img/guide/index.json'));
const rawImages = []; // [source, target] copied after the output folder exists

function pngSize(file) {
  const b = readFileSync(file);
  return b.toString('ascii', 12, 16) === 'IHDR'
    ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    : null;
}

function guideImage(src, alt) {
  let url;
  let size;
  if (guideImages[src]) {
    url = `/img/guide/${guideImages[src].file}`;
    size = guideImages[src];
  } else {
    const source = path.join(ROOT, 'docs', src);
    if (!existsSync(source)) throw new Error(`docs/USER-GUIDE.md: picture not found: ${src}`);
    const name = path
      .relative(path.join(ROOT, 'artifacts', 'screens'), source)
      .split(path.sep)
      .join('--');
    url = `/img/guide-raw/${name}`;
    size = pngSize(source);
    rawImages.push([source, path.join(OUT, 'img', 'guide-raw', name)]);
    console.warn(`docs/USER-GUIDE.md: ${src} has no tidied copy; run python site/tools/screens.py`);
  }
  const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
  const tall = size && size.height > size.width ? ' tall' : '';
  return `<figure class="frame doc-figure${tall}"><button type="button" class="shot" data-lightbox><img src="${url}"${dims} loading="lazy" alt="${esc(alt)}" /></button><figcaption>${esc(alt)}</figcaption></figure>`;
}

// ---------------------------------------------------------------------------------------------
// Pages

const layout = await read('site/layout.html');
const pages = []; // { path, html }

function nav(active) {
  const items = [
    ['/#features', 'Features', 'home'],
    ['/docs/', 'Guide', 'docs'],
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

function page({ path: urlPath, page: kind, title, description, main }) {
  const html = fill(
    layout,
    {
      TITLE: esc(title),
      DESCRIPTION: esc(description),
      PATH: urlPath,
      PAGE: kind,
      NAV: nav(kind),
      MAIN: main,
      REPO_URL,
      YEAR: String(new Date().getUTCFullYear()),
    },
    'site/layout.html'
  );
  pages.push({ path: urlPath, html });
}

// Home --------------------------------------------------------------------------------------

const heroActions = stable
  ? `<a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download for Windows</a>
<a class="button" href="/docs/">${ICON_BOOK}Read the guide</a>
<p class="hero-note">Version ${esc(stable.version)}, ${megabytes(stable.installer.size)}, for Windows 10 and 11. Free and <a href="${REPO_URL}">open source</a>.</p>`
  : `<a class="button primary" href="/download/">${ICON_DOWNLOAD}Get version 2.0</a>
<a class="button" href="/docs/">${ICON_BOOK}Read the guide</a>
<p class="hero-note">Version 2.0 is in final testing; the installer is not published yet. Windows 10 and 11, free and <a href="${REPO_URL}">open source</a>.</p>`;

const getNote = stable
  ? `Version ${esc(stable.version)} for Windows 10 and 11, released ${longDate(stable.date)}. Free and open source.`
  : 'Version 2.0 is in final testing. The download page has where it stands and how to run it from source today.';
const getActions = stable
  ? `<a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download for Windows</a>
<a class="button" href="/download/">All downloads and the changelog</a>`
  : `<a class="button primary" href="/download/">${ICON_DOWNLOAD}Get version 2.0</a>
<a class="button" href="/docs/create-your-first-setup/">${ICON_BOOK}Read the guide</a>`;

page({
  path: '/',
  page: 'home',
  title: 'RigReady: your sim rig, ready before the game loads',
  description:
    'RigReady is a free, open-source Windows app for flight and racing sim rigs. It checks controllers, helper apps, monitors, audio and game files, fixes what it can, and launches the game.',
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
    { RELEASE: releaseCard, SOURCE: fromSource, CHANGELOG: changelog(), REPO_URL },
    'site/pages/download.html'
  ),
});

// Docs: the user guide, one page per chapter, and the contributing guide ---------------------

const guide = sections(await read('docs/USER-GUIDE.md'));
const chapters = guide.sections.map((s) => {
  const number = /^(\d+)\.\s+/.exec(s.title)?.[1] ?? null;
  const title = s.title.replace(/^\d+\.\s+/, '');
  return { number, title, slug: slugify(title), body: s.body, summary: summary(s.body) };
});
const docsTemplate = await read('site/pages/docs.html');
const guideLink = docLink('docs/USER-GUIDE.md');

function sidebar(current) {
  const item = (href, label, number, key) =>
    `<li><a href="${href}"${key === current ? ' aria-current="page"' : ''}>${number ? `<span class="n">${number}</span>` : ''}${esc(label)}</a></li>`;
  return `<p class="docs-nav-title"><a href="/docs/"${current === 'index' ? ' aria-current="page"' : ''}>User guide</a></p>
<ul class="docs-list">${chapters.map((c) => item(`/docs/${c.slug}/`, c.title, c.number, c.slug)).join('')}</ul>
<p class="docs-nav-title">Project</p>
<ul class="docs-list">${item('/docs/contributing/', 'Contributing', null, 'contributing')}${item('/download/#changelog', 'Changelog', null, null)}${item(`${REPO_URL}/tree/main/docs`, 'Developer documents', null, null)}</ul>`;
}

function pager(prev, next) {
  const a = (c, rel) =>
    c
      ? `<a class="pager-${rel}" href="${c.href}" rel="${rel}"><span>${rel === 'prev' ? 'Previous' : 'Next'}</span>${esc(c.title)}</a>`
      : '<span></span>';
  return `<nav class="pager" aria-label="Chapters">${a(prev, 'prev')}${a(next, 'next')}</nav>`;
}

function docsPage({ path: urlPath, key, title, description, article, prev, next, source }) {
  page({
    path: urlPath,
    page: 'docs',
    title,
    description,
    main: fill(
      docsTemplate,
      {
        SIDEBAR: sidebar(key),
        ARTICLE: article,
        PAGER: pager(prev, next),
        EDIT_URL: `${REPO_URL}/edit/main/${source}`,
      },
      'site/pages/docs.html'
    ),
  });
}

const chapterLink = (c) => c && { href: `/docs/${c.slug}/`, title: c.title };

docsPage({
  path: '/docs/',
  key: 'index',
  title: 'RigReady user guide',
  description:
    'How to use RigReady, task by task: setups, the Play screen, monitors, DCS, bindings, cheat sheets, backups, sharing and hardware.',
  source: 'docs/USER-GUIDE.md',
  article: `<h1>${esc(guide.title ?? 'User guide')}</h1>
${render(guide.preamble, { link: guideLink })}
<ol class="chapters">${chapters
    .map(
      (c) =>
        `<li><a href="/docs/${c.slug}/"><span class="n">${c.number ?? ''}</span><strong>${esc(c.title)}</strong><span class="summary">${esc(c.summary)}</span></a></li>`
    )
    .join('')}</ol>
<h2>For contributors</h2>
<p>The <a href="/docs/contributing/">contributing guide</a> covers setup and the rules. The developer documents live with the code: <a href="${REPO_URL}/blob/main/docs/PRODUCT.md">what the product is</a>, <a href="${REPO_URL}/blob/main/docs/ARCHITECTURE.md">how it is put together</a>, <a href="${REPO_URL}/blob/main/docs/CONTRIBUTING-FEATURES.md">how to add a feature</a> and <a href="${REPO_URL}/blob/main/docs/requirements/ledger.yaml">every requirement with its evidence</a>.</p>`,
  prev: null,
  next: chapterLink(chapters[0]),
});

chapters.forEach((c, i) => {
  docsPage({
    path: `/docs/${c.slug}/`,
    key: c.slug,
    title: `${c.title} | RigReady user guide`,
    description: c.summary || `${c.title}, from the RigReady user guide.`,
    source: 'docs/USER-GUIDE.md',
    article: `<p class="chapter-of">${c.number ? `Chapter ${c.number} of the ` : 'From the '}<a href="/docs/">user guide</a></p>
<h1>${esc(c.title)}</h1>
${render(c.body, { shift: -1, link: guideLink, image: guideImage })}`,
    prev: i === 0 ? { href: '/docs/', title: 'User guide' } : chapterLink(chapters[i - 1]),
    next: chapterLink(chapters[i + 1]),
  });
});

const contributing = sections(await read('CONTRIBUTING.md'));
docsPage({
  path: '/docs/contributing/',
  key: 'contributing',
  title: 'Contributing to RigReady',
  description:
    'How to set up RigReady for development, the rules a change follows, and how a pull request is checked.',
  source: 'CONTRIBUTING.md',
  article: `<h1>${esc(contributing.title ?? 'Contributing')}</h1>
${render(await read('CONTRIBUTING.md').then((md) => md.replace(/^#\s+.*\n/, '')), { link: docLink('CONTRIBUTING.md') })}`,
  prev: chapterLink(chapters[chapters.length - 1]),
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
await mkdir(path.join(OUT, 'download', 'latest'), { recursive: true });
await writeFile(path.join(OUT, 'download', 'latest', 'index.html'), redirect);
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
  `Built _site: ${pages.length} pages; ${stable ? `download ${stable.version} (${stable.installer.name})` : 'no release of this major version yet'}` +
    `${beta ? `, beta ${beta.version}` : ''}.`
);
