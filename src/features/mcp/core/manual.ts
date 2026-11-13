/**
 * The user manual (docs/manual/<section>/<page>.md), bundled into the app so an assistant can
 * read it as resources: `rigready://docs` (the contents), `rigready://docs/<section>` (a
 * section's own page) and `rigready://docs/<section>/<page>`. Each file's front matter
 * gives the resource its title and description; the website is built from the same files.
 */

export interface ManualPage {
  /** "getting-started/first-setup", "play" for a section's index, "" for the manual's. */
  path: string;
  section: string;
  /** Empty for a section's own page. */
  page: string;
  title: string;
  description: string;
  order: number;
  /** The Markdown without the front matter. */
  body: string;
  uri: string;
}

export const DOCS_URI = 'rigready://docs';
/** Where the website publishes the manual. */
export const DOCS_WEB = 'https://rigready.io/docs';

/** A page's address on the website: https://rigready.io/docs/setups/scripts/. */
export function webUrl(path: string): string {
  return path === '' ? `${DOCS_WEB}/` : `${DOCS_WEB}/${path}/`;
}

export function docsUri(path: string): string {
  return path === '' ? DOCS_URI : `${DOCS_URI}/${path}`;
}

export interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

/** `key: value` lines between the `---` lines; quotes around a value are taken off. */
export function parseFrontMatter(text: string): FrontMatter | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return undefined;
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    let value = pair[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    data[pair[1]!] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

/** The pages of a manual from its files (path relative to docs/manual, forward slashes). Sorted by section, then order, then slug. */
export function manualPages(files: Record<string, string>): ManualPage[] {
  const pages: ManualPage[] = [];
  for (const [file, text] of Object.entries(files)) {
    const relative = file.replace(/\\/g, '/').replace(/^.*?docs\/manual\//, '');
    const parts = relative.replace(/\.md$/, '').split('/');
    if (parts.length > 2) continue;
    const parsed = parseFrontMatter(text);
    if (!parsed || !parsed.data['title'] || !parsed.data['description']) continue;
    const isIndex = parts[parts.length - 1] === 'index';
    const section = parts.length === 2 ? parts[0]! : isIndex ? '' : parts[0]!;
    const page = parts.length === 2 ? (isIndex ? '' : parts[1]!) : '';
    const path = section === '' ? '' : page === '' ? section : `${section}/${page}`;
    pages.push({
      path,
      section,
      page,
      title: parsed.data['title'],
      description: parsed.data['description'],
      order: Number.parseInt(parsed.data['order'] ?? '1000', 10) || 1000,
      body: parsed.body,
      uri: docsUri(path),
    });
  }
  const sectionOrder = new Map(
    pages.filter((p) => p.page === '' && p.section !== '').map((p) => [p.section, p.order])
  );
  return pages.sort(
    (a, b) =>
      (a.section === '' ? -1 : (sectionOrder.get(a.section) ?? 1000)) -
        (b.section === '' ? -1 : (sectionOrder.get(b.section) ?? 1000)) ||
      a.section.localeCompare(b.section) ||
      (a.page === '' ? -1 : a.order) - (b.page === '' ? -1 : b.order) ||
      a.page.localeCompare(b.page)
  );
}

/** The contents of the manual as Markdown: every section with its pages and their URIs. */
export function renderContents(pages: ManualPage[]): string {
  const lines = ['# The RigReady manual', ''];
  const root = pages.find((p) => p.path === '');
  if (root) lines.push(root.description, '');
  for (const section of pages.filter((p) => p.page === '' && p.section !== '')) {
    lines.push(`## ${section.title} (${section.uri})`, '', section.description, '');
    for (const page of pages.filter((p) => p.section === section.section && p.page !== '')) {
      lines.push(`- ${page.title}: ${page.description} (${page.uri})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface ManualHit {
  uri: string;
  /** The page on the website, to link in an answer. */
  url: string;
  title: string;
  /** Lines that hold every word of the query, with a little around them. */
  lines: string[];
  /** The headings those lines stand under: what to ask manual_read for instead of the whole page. */
  sections?: string[];
}

interface BodyLine {
  text: string;
  /** 1 to 6 for a heading, 0 for any other line. */
  level: number;
  /** The heading this line is, or stands under; empty before the first one. */
  under: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A page line by line with the heading each stands under. A "#" inside a code fence is no heading. */
function walk(body: string): BodyLine[] {
  let fenced = false;
  let under = '';
  return body.split(/\r?\n/).map((text) => {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      return { text, level: 0, under };
    }
    const heading = fenced ? null : HEADING.exec(text);
    if (heading) under = heading[2] ?? '';
    return { text, level: heading ? (heading[1] ?? '').length : 0, under };
  });
}

const plainHeading = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The headings of a page, in its order. */
export function sectionsOf(body: string): string[] {
  return walk(body)
    .filter((line) => line.level > 0)
    .map((line) => line.under);
}

/**
 * One section of a page: its heading and what stands under it, up to the next heading of the
 * same level or above. By the heading as written, or by a part of it when no heading is it.
 */
export function sectionOf(body: string, wanted: string): string | undefined {
  const want = plainHeading(wanted);
  if (!want) return undefined;
  const lines = walk(body);
  let start = lines.findIndex((line) => line.level > 0 && plainHeading(line.under) === want);
  if (start < 0) {
    start = lines.findIndex((line) => line.level > 0 && plainHeading(line.under).includes(want));
  }
  const first = lines[start];
  if (!first) return undefined;
  let end = lines.findIndex((line, i) => i > start && line.level > 0 && line.level <= first.level);
  if (end < 0) end = lines.length;
  return lines
    .slice(start, end)
    .map((line) => line.text)
    .join('\n')
    .trim();
}

/** Pages that hold every word of the query, the best first: the title, then the description, then the body. */
export function searchManual(pages: ManualPage[], query: string, limit = 8): ManualHit[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const scored: { hit: ManualHit; score: number }[] = [];
  for (const page of pages) {
    const title = page.title.toLowerCase();
    const description = page.description.toLowerCase();
    const body = page.body.toLowerCase();
    if (!words.every((w) => title.includes(w) || description.includes(w) || body.includes(w)))
      continue;
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 10;
      if (description.includes(w)) score += 4;
      score += Math.min(5, body.split(w).length - 1);
    }
    const matching = walk(page.body)
      .filter((line) => {
        const lower = line.text.toLowerCase();
        return words.some((w) => lower.includes(w)) && line.text.trim() !== '';
      })
      .slice(0, 4);
    const lines = matching.map((line) => line.text.trim().slice(0, 240));
    const sections = [...new Set(matching.map((line) => line.under).filter((s) => s !== ''))];
    scored.push({
      hit: {
        uri: page.uri,
        url: webUrl(page.path),
        title: page.title,
        lines,
        ...(sections.length > 0 ? { sections } : {}),
      },
      score,
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title))
    .slice(0, limit)
    .map((s) => s.hit);
}

/**
 * The path a reference to a page means: "setups/scripts", "rigready://docs/setups/scripts" or
 * "https://rigready.io/docs/setups/scripts/" all name the same page.
 */
export function pagePath(reference: string): string {
  let path = reference.trim();
  for (const prefix of [`${DOCS_URI}/`, DOCS_URI, `${DOCS_WEB}/`, DOCS_WEB, '/docs/']) {
    if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
      path = path.slice(prefix.length);
      break;
    }
  }
  return path.replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
}

/**
 * One page as Markdown, with its title and description first: for a resource read and the
 * manual_read tool. With a section, only that part of the page under the page's title.
 */
export function readManualPage(
  pages: ManualPage[],
  reference: string,
  section?: string
): { ok: true; page: ManualPage; text: string } | { ok: false; message: string } {
  const path = pagePath(reference);
  const page = pages.find((p) => p.path === path);
  if (!page) {
    return {
      ok: false,
      message: `There is no manual page at ${docsUri(path)}. Search with manual_search, or read ${DOCS_URI} for the list.`,
    };
  }
  if (section === undefined || section.trim() === '') {
    return { ok: true, page, text: `# ${page.title}\n\n${page.description}\n\n${page.body}` };
  }
  const part = sectionOf(page.body, section);
  if (part === undefined) {
    const sections = sectionsOf(page.body);
    return {
      ok: false,
      message: `The manual page ${page.title} has no section "${section.trim()}". ${
        sections.length > 0
          ? `Its sections: ${sections.join('; ')}.`
          : 'It has no sections: read the whole page.'
      }`,
    };
  }
  return { ok: true, page, text: `# ${page.title}\n\n${part}` };
}

/** The manual as the app ships it. Read once; a build without the files gives an empty manual. */
let bundled: ManualPage[] | undefined;
export function bundledManual(): ManualPage[] {
  if (bundled) return bundled;
  const files = import.meta.glob<string>('../../../../docs/manual/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  bundled = manualPages(files);
  return bundled;
}
