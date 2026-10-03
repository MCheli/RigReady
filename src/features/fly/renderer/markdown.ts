/**
 * A very small Markdown subset for instructions written into a setup: paragraphs,
 * "- " bullet lists, "1. " numbered lists, **bold**, `code` and [links](https://...).
 * It produces plain data that the component renders as text nodes: no HTML from the
 * profile is ever interpreted, so nothing in it can run.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export type Block =
  { kind: 'paragraph'; content: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (match[1] !== undefined) out.push({ kind: 'bold', text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'code', text: match[2] });
    else if (match[3] !== undefined && match[4] !== undefined) {
      // Only web links open, and only after the user agrees; anything else stays text.
      if (/^https:\/\//i.test(match[4])) out.push({ kind: 'link', text: match[3], url: match[4] });
      else out.push({ kind: 'text', text: `${match[3]} (${match[4]})` });
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = undefined;
    }
  };
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (line === '') {
      flush();
    } else if (bullet || numbered) {
      const ordered = numbered !== null;
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (list && /^\s{2,}/.test(raw)) {
      // An indented line continues the list item above.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
