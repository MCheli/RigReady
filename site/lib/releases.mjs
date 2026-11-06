// The published GitHub releases the site offers for download.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** "2.1.0" or "2.2.0-beta.3", with or without a leading v. Anything else is not a release. */
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(String(text).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, preN: m[5] ? +m[5] : 0 };
}

export function compareVersions(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] - b[k];
  if (a.pre === b.pre) return a.preN - b.preN;
  return a.pre === null ? 1 : b.pre === null ? -1 : 0; // a release is newer than its betas
}

/** The releases list from GitHub, or from the file named by RELEASES_JSON (offline builds). */
export async function loadReleases(repo) {
  if (process.env.RELEASES_JSON) {
    return JSON.parse(await readFile(path.resolve(process.env.RELEASES_JSON), 'utf8'));
  }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'rigready-site-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers,
  });
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
  return res.json();
}

/**
 * The newest release and, when there is a newer one, the newest beta, of `major` or later.
 * Drafts, other pre-release kinds (the app refuses -dev, -alpha and -rc) and releases without an
 * installer are ignored. `tags` maps every published tag to its release page.
 */
export function pickReleases(list, major) {
  const usable = [];
  for (const r of list) {
    const v = parseVersion(r.tag_name);
    if (r.draft || !v || v.major < major) continue;
    if (v.pre !== null && v.pre !== 'beta') continue;
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
  const beta =
    usable.find((r) => r.v.pre === 'beta' && (!stable || compareVersions(r.v, stable.v) > 0)) ??
    null;
  const tags = new Map(list.filter((r) => !r.draft).map((r) => [r.tag_name, r.html_url]));
  return { stable, beta, tags };
}
