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
  title: string;
  /** Lines that hold every word of the query, with a little around them. */
  lines: string[];
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
    const lines = page.body
      .split(/\r?\n/)
      .filter((line) => {
        const lower = line.toLowerCase();
        return words.some((w) => lower.includes(w)) && line.trim() !== '';
      })
      .slice(0, 4)
      .map((line) => line.trim().slice(0, 240));
    scored.push({ hit: { uri: page.uri, title: page.title, lines }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title))
    .slice(0, limit)
    .map((s) => s.hit);
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
