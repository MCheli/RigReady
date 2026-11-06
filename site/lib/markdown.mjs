// The markdown the project's documents use, and nothing more: headings, paragraphs, "-" and "1."
// lists (a line indented under an item continues it), fenced code, "|" tables, ">" quotes, a
// picture on a line of its own, and inline code, links, <autolinks>, bold and italics. No
// dependencies, so the site build needs no npm install.

export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** "3. Monitors" -> "monitors"; "The binding guide and AI help" -> "the-binding-guide-and-ai-help". */
export const slugify = (text) =>
  String(text)
    .replace(/^\d+\.\s+/, '')
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Inline markdown. Everything is escaped; then code, links, bold and italics are put back.
 * `link(href)` turns a document's own link target into the URL the site uses.
 */
export function inline(text, { link = (href) => href } = {}) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      let s = esc(part);
      s = s.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_, label, href) => `<a href="${esc(link(href))}">${label}</a>`
      );
      s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
      return s;
    })
    .join('');
}

/** The cells of a table row: "| a | b |" -> ["a", "b"]; a "\|" inside a cell is a "|". */
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
const isTableRow = (line) => /^\s*\|/.test(line ?? '');
const isTableRule = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line ?? '');

/**
 * Block markdown to HTML.
 * - `shift`: added to every heading level (a "##" chapter heading rendered as a page's h1 is -1).
 * - `boldLineHeading`: a line that is only **bold** becomes an h5 (the changelog's group names).
 * - `link(href)`: as for inline().
 * - `image(src, alt)`: the HTML for a picture on its own line.
 */
export function render(markdown, { shift = 0, boldLineHeading = false, link, image } = {}) {
  const lines = String(markdown).split(/\r?\n/);
  const html = [];
  let para = [];
  let list = null; // { tag: 'ul' | 'ol', items: [] }
  const opts = { link };
  const options = { shift, boldLineHeading, link, image };

  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '), opts)}</p>`);
    if (list)
      html.push(
        `<${list.tag}>${list.items.map((li) => `<li>${inline(li, opts)}</li>`).join('')}</${list.tag}>`
      );
    para = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    let m;
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      flush();
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      const level = Math.min(6, Math.max(1, m[1].length + shift));
      html.push(`<h${level} id="${slugify(m[2])}">${inline(m[2], opts)}</h${level}>`);
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim()))) {
      flush();
      html.push(image ? image(m[2], m[1]) : `<p><img src="${esc(m[2])}" alt="${esc(m[1])}"></p>`);
    } else if (isTableRow(line) && isTableRule(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows = [];
      i += 1;
      while (isTableRow(lines[i + 1])) rows.push(cells(lines[++i]));
      const row = (cs, tag) =>
        `<tr>${cs.map((c) => `<${tag}>${inline(c, opts)}</${tag}>`).join('')}</tr>`;
      html.push(
        `<table><thead>${row(head, 'th')}</thead><tbody>${rows.map((r) => row(r, 'td')).join('')}</tbody></table>`
      );
    } else if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
      }
      i -= 1;
      html.push(`<blockquote>\n${render(quoted.join('\n'), options)}\n</blockquote>`);
    } else if (boldLineHeading && /^\*\*[^*]+\*\*$/.test(line.trim())) {
      flush();
      html.push(`<h5>${inline(line.trim().slice(2, -2), opts)}</h5>`);
    } else if ((m = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line))) {
      const tag = m[1] ? 'ul' : 'ol';
      if (para.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(m[3]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

/**
 * Splits a document at one heading level ("##" by default) into its preamble and sections.
 * Fenced code is respected, so a "## " inside a code block does not split.
 */
export function sections(markdown, level = 2) {
  const marker = new RegExp(`^${'#'.repeat(level)}\\s+(.*)$`);
  const out = { title: null, preamble: [], sections: [] };
  let current = null;
  let fenced = false;
  for (const line of String(markdown).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && marker.exec(line);
    const top = !fenced && /^#\s+(.*)$/.exec(line);
    if (top && !out.title && !current) {
      out.title = top[1].trim();
    } else if (m) {
      current = { title: m[1].trim(), lines: [] };
      out.sections.push(current);
    } else {
      (current ? current.lines : out.preamble).push(line);
    }
  }
  for (const s of out.sections) s.body = s.lines.join('\n');
  out.preamble = out.preamble.join('\n');
  return out;
}
