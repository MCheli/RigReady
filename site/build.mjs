// Builds the rigready.io website into _site/.
//
//   node site/build.mjs                                 (from the repository root)
//   RELEASES_JSON=releases.json node site/build.mjs     (offline: GitHub's releases list from a file)
//
// The page is site/index.html with {{SLOTS}} filled in from two sources, so the site follows the
// project without anyone editing it:
// - the published GitHub releases: the download buttons, the version and the size of the installer.
//   Drafts are ignored, and so is anything older than the major version in package.json (1.x is a
//   different app). Until a release of this major version is published, the page says so and points
//   to the source instead of a download.
// - CHANGELOG.md: the changelog section, every version, as the file has it.
// .github/workflows/site.yml runs this on every change to those and publishes _site to GitHub Pages.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const REPO = 'MCheli/RigReady';
const REPO_URL = 'https://github.com/MCheli/rigready';
const DOMAIN = 'rigready.io';

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const MAJOR = parseVersion(pkg.version).major;

// ---------------------------------------------------------------------------------------------
// Releases

/** "2.1.0" or "2.2.0-beta.3", with or without a leading v. Anything else is not a release. */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(String(text).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, preN: m[5] ? +m[5] : 0 };
}

function compareVersions(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] - b[k];
  if (a.pre === b.pre) return a.preN - b.preN;
  return a.pre === null ? 1 : b.pre === null ? -1 : 0; // a release is newer than its betas
}

async function loadReleases() {
  if (process.env.RELEASES_JSON) {
    return JSON.parse(await readFile(path.resolve(process.env.RELEASES_JSON), 'utf8'));
  }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'rigready-site-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers,
  });
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  return res.json();
}

/** The newest release and, when there is a newer one, the newest beta, of this major version. */
function pickReleases(list) {
  const usable = [];
  for (const r of list) {
    const v = parseVersion(r.tag_name);
    if (r.draft || !v || v.major < MAJOR) continue;
    if (v.pre !== null && v.pre !== 'beta') continue; // the app refuses -dev, -alpha and -rc too
    const exe = (r.assets ?? []).find((a) => /^RigReady-Setup-.+\.exe$/.test(a.name));
    if (!exe) continue;
    usable.push({
      v,
      version: r.tag_name.replace(/^v/, ''),
      tag: r.tag_name,
      page: r.html_url,
      date: r.published_at,
      installer: { name: exe.name, url: exe.browser_download_url, size: exe.size },
    });
  }
  usable.sort((a, b) => compareVersions(b.v, a.v));
  const stable = usable.find((r) => r.v.pre === null) ?? null;
  const beta = usable.find(
    (r) => r.v.pre === 'beta' && (!stable || compareVersions(r.v, stable.v) > 0)
  );
  return {
    stable,
    beta: beta ?? null,
    tags: new Map(list.filter((r) => !r.draft).map((r) => [r.tag_name, r.html_url])),
  };
}

// ---------------------------------------------------------------------------------------------
// HTML helpers

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

const longDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Inline markdown: code, links, bold, italics. Escapes everything else. */
function inline(text) {
  const parts = text.split(/(`[^`]+`)/);
  return parts
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      let s = esc(part);
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        const url = /^(https?:|mailto:|#)/.test(href)
          ? href
          : `${REPO_URL}/blob/main/${href.replace(/^\.?\//, '')}`;
        return `<a href="${url}">${label}</a>`;
      });
      s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
      return s;
    })
    .join('');
}

/** The block markdown CHANGELOG.md uses: headings, paragraphs, "- " lists, a bold line as a subheading. */
function blocks(lines) {
  const html = [];
  let para = [];
  let list = null;
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    if (list) html.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    para = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
    } else if (/^###\s+/.test(line)) {
      flush();
      html.push(`<h4>${inline(line.replace(/^###\s+/, ''))}</h4>`);
    } else if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      flush();
      html.push(`<h5>${inline(line.trim().slice(2, -2))}</h5>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) flush();
      (list ??= []).push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (list && /^\s{2,}\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

function renderChangelog(markdown, tags) {
  const sections = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#\s/.test(line)) continue;
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      current = { title: h[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections
    .map((s, i) => {
      const version = /^(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(s.title)?.[1];
      const page = version && tags.get(`v${version}`);
      const link = page ? ` <a class="release-link" href="${page}">Release on GitHub</a>` : '';
      return `<details class="version"${i === 0 ? ' open' : ''}>
<summary><h3>${inline(s.title)}</h3></summary>
<div class="version-body">${link ? `<p>${link}</p>` : ''}
${blocks(s.lines)}
</div>
</details>`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// The release-dependent parts of the page

const ICON_DOWNLOAD =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_GITHUB =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';

function heroActions({ stable }) {
  if (stable) {
    return `<a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download for Windows</a>
<a class="button" href="${REPO_URL}">${ICON_GITHUB}Source on GitHub</a>
<p class="hero-note">Version ${esc(stable.version)}, ${megabytes(stable.installer.size)}. Windows 10 and 11, free and open source.</p>`;
  }
  return `<a class="button primary" href="#download">${ICON_DOWNLOAD}Get version 2.0</a>
<a class="button" href="${REPO_URL}">${ICON_GITHUB}Source on GitHub</a>
<p class="hero-note">Version 2.0 is in final testing; the installer is not published yet. Windows 10 and 11, free and open source.</p>`;
}

function downloadSection({ stable, beta }) {
  const requirements = `<ul class="facts">
<li>Windows 10 or 11, 64-bit.</li>
<li>Installs for your account only. It never asks for administrator rights.</li>
<li>Updates itself from GitHub Releases, on the stable or the beta channel (Settings, Updates). Never while a game is running.</li>
<li>Uninstalling keeps your setups and backups unless you choose to remove them.</li>
</ul>`;
  const betaLine = beta
    ? `<p>A beta of the next version is out: <a href="${beta.installer.url}">RigReady ${esc(beta.version)}</a> (${megabytes(beta.installer.size)}, <a href="${beta.page}">notes</a>). Installed copies get betas only on the beta channel.</p>`
    : '';
  if (stable) {
    return `<div class="download-card">
<p class="download-version">RigReady ${esc(stable.version)}</p>
<p class="download-meta">Released ${longDate(stable.date)}. Installer, ${megabytes(stable.installer.size)}.</p>
<p><a class="button primary" href="${stable.installer.url}">${ICON_DOWNLOAD}Download ${esc(stable.installer.name)}</a></p>
<p class="small">The installer is not code-signed yet, so Windows SmartScreen warns the first time it runs. Choose <em>More info</em>, then <em>Run anyway</em>. <a href="${stable.page}">Release notes</a> and every earlier version are on <a href="${REPO_URL}/releases">GitHub Releases</a>.</p>
</div>
${betaLine}
${requirements}`;
  }
  return `<div class="download-card">
<p class="download-version">Version 2.0 is almost here</p>
<p>RigReady 2.0 is a rebuild from the ground up, and it is being checked on real rigs before the first installer goes out. When it is published, the download appears on this page.</p>
<p>To hear about it, watch the repository on GitHub: <em>Watch</em>, then <em>Custom</em>, then <em>Releases</em>.</p>
<p><a class="button primary" href="${REPO_URL}">${ICON_GITHUB}Watch on GitHub</a></p>
</div>
${betaLine}
<h3>Run it from source today</h3>
<p>Windows 10 or 11 and Node.js 22.12 or newer. The first command runs the app on a recorded rig in a temporary folder; it changes nothing on your PC.</p>
<pre><code>git clone ${REPO_URL}.git
cd rigready
npm ci
npm run dev:scenario -- flying-all-good</code></pre>
<p>To run it on your own rig: <code>npm run setup:python</code> once, then <code>npm run dev</code>.</p>
<p class="small">Version 1.1.0, the first RigReady, is still on <a href="${REPO_URL}/releases">GitHub Releases</a>. Version 2.0 replaces it and does not read its setups.</p>
<h3>When it is released</h3>
${requirements}`;
}

/** /download: a stable link to the newest installer (for other sites and posts), or to this page. */
function downloadRedirect({ stable }) {
  const target = stable ? stable.installer.url : '/#download';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Download RigReady</title>
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="https://${DOMAIN}/#download"></head>
<body><p><a href="${target}">Download RigReady</a></p></body></html>
`;
}

// ---------------------------------------------------------------------------------------------

let releases;
try {
  releases = pickReleases(await loadReleases());
} catch (err) {
  // In CI a wrong answer ("not released yet" after a release) is worse than no deploy.
  if (process.env.CI) throw err;
  console.warn(`Could not read releases (${err.message}); building as if none were published.`);
  releases = { stable: null, beta: null, tags: new Map() };
}

const changelog = renderChangelog(
  await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8'),
  releases.tags
);
const slots = {
  HERO_ACTIONS: heroActions(releases),
  DOWNLOAD: downloadSection(releases),
  CHANGELOG: changelog,
  REPO_URL,
  YEAR: String(new Date().getUTCFullYear()),
};

let page = await readFile(path.join(SITE, 'index.html'), 'utf8');
page = page.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
  if (!(key in slots)) throw new Error(`site/index.html: unknown slot ${m}`);
  return slots[key];
});

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'download'), { recursive: true });
for (const item of ['style.css', 'main.js', 'favicon.svg', 'fonts', 'img']) {
  await cp(path.join(SITE, item), path.join(OUT, item), { recursive: true });
}
await writeFile(path.join(OUT, 'index.html'), page);
await writeFile(path.join(OUT, 'download', 'index.html'), downloadRedirect(releases));
await writeFile(path.join(OUT, 'CNAME'), `${DOMAIN}\n`);
await writeFile(
  path.join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: https://${DOMAIN}/sitemap.xml\n`
);
await writeFile(
  path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${DOMAIN}/</loc></url></urlset>\n`
);

const s = releases.stable;
console.log(
  `Built _site: ${s ? `download ${s.version} (${s.installer.name})` : 'no release of this major version yet'}` +
    `${releases.beta ? `, beta ${releases.beta.version}` : ''}.`
);
