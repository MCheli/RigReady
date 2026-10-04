/**
 * What the About panel says about RigReady that is not known until it runs: taken from the
 * package's own description of itself (package.json), so the panel can never disagree with
 * what was built and no name or address is written into the app's source.
 */

export interface PackageFacts {
  license?: string;
  homepage?: string;
  author?: { name?: string; url?: string } | string;
  repository?: { url?: string } | string;
  bugs?: { url?: string } | string;
}

export interface AboutLink {
  id: 'website' | 'source' | 'issues';
  label: string;
  url: string;
  /** The address as shown: without the scheme. */
  shown: string;
}

export interface AboutFacts {
  /** "MIT". */
  licence?: string;
  author?: string;
  links: AboutLink[];
}

const urlOf = (value: { url?: string } | string | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.url;

/**
 * A web address to open, or nothing: only https, since that is all the app hands to the
 * browser. A repository address as npm writes it ("git+https://host/path.git") is turned
 * into the page a person opens.
 */
export function webLink(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  try {
    const url = new URL(cleaned);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : undefined;
  } catch {
    // Not an address at all (a "github:owner/repo" shorthand, say): nothing to link to.
    return undefined;
  }
}

export function aboutFacts(pkg: PackageFacts): AboutFacts {
  const links: AboutLink[] = [];
  const add = (id: AboutLink['id'], label: string, raw: string | undefined): void => {
    const url = webLink(raw);
    if (url) links.push({ id, label, url, shown: url.replace(/^https:\/\/(www\.)?/, '') });
  };
  add('website', 'Website', pkg.homepage);
  add('source', 'Source code', urlOf(pkg.repository));
  add('issues', 'Report a problem', urlOf(pkg.bugs));
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  return {
    ...(pkg.license ? { licence: pkg.license } : {}),
    ...(author ? { author } : {}),
    links,
  };
}
