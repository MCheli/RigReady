/**
 * The part of Markdown an assistant's reply uses, parsed to a tree: paragraphs, headings,
 * lists, quotes, code, bold, italics and links. Pure, and safe on any text: what a model
 * writes is untrusted (a page it read may have put words in its mouth), so nothing here
 * ever becomes markup. HTML in the text stays text, an image is never loaded, and a link is
 * kept only when it is a plain web address. The panel turns the tree into elements
 * (renderer/markdownView.ts); no HTML string is made anywhere.
 *
 * Every limit below bounds the work a hostile or broken reply can cause.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'break' };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'rule' };

/** Longer than this, a reply is shown as plain text. */
export const MAX_MARKDOWN = 100_000;
/** Lists in lists and quotes in quotes, this deep; deeper is shown as text. */
const MAX_DEPTH = 8;
/** Bold in italics in bold, this deep; deeper is shown as text. */
const MAX_NESTING = 12;
/** Runs of * and _ looked at in one paragraph; with more, none of them is emphasis. */
const MAX_DELIMITERS = 1000;
/** The label of a link, at most. */
const MAX_LABEL = 300;
/** A web address, at most. */
const MAX_LINK = 2000;

/** Marks that turn the direction of text around: they can make an address read as another. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
/** Control characters other than the line break. */
const CONTROL = /[^\P{Cc}\n]/gu;

export function parseMarkdown(source: string): Block[] {
  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(BIDI, '')
    .replace(CONTROL, '');
  if (text.length > MAX_MARKDOWN) return plain(text);
  return blocks(text.split('\n'), 0);
}

/** A web address a link may lead to: http or https, a host, no sign-in part. */
export function safeLink(raw: string): string | undefined {
  const dest = raw.trim();
  if (dest.length === 0 || dest.length > MAX_LINK) return undefined;
  // The host follows the two slashes at once: "https:///x" would be read as the host x.
  if (!/^https?:\/\/[A-Za-z0-9[\u0080-\uFFFF]/i.test(dest)) return undefined;
  for (const c of dest) if (c === '\\' || isSpace(c)) return undefined;
  let url: URL;
  try {
    url = new URL(dest);
  } catch {
    // Not an address a browser could open: it stays text.
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return undefined;
  return url.href;
}

/** The text of a tree with every mark taken away: what a screen reader or a search would get. */
export function plainText(blocksOrInlines: (Block | Inline)[]): string {
  const parts: string[] = [];
  const walk = (node: Block | Inline): void => {
    switch (node.kind) {
      case 'text':
        parts.push(node.text);
        return;
      case 'code':
        parts.push(node.text);
        return;
      case 'break':
        parts.push('\n');
        return;
      case 'rule':
        return;
      case 'list':
        for (const item of node.items) item.forEach(walk);
        return;
      default:
        node.children.forEach(walk);
    }
  };
  blocksOrInlines.forEach(walk);
  return parts.join('');
}

// ---- blocks ---------------------------------------------------------------------------

function plain(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .filter((part) => part.trim() !== '')
    .map((part) => ({ kind: 'paragraph', children: lines(part) }));
}

/** Text as it is, with its line breaks. */
function lines(text: string): Inline[] {
  const out: Inline[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ kind: 'break' });
    if (line !== '') out.push({ kind: 'text', text: line });
  });
  return out;
}

function isSpace(c: string | undefined): boolean {
  return c === undefined || c === ' ' || c === '\n' || c === ' ' || /\s/.test(c);
}

function indentOf(line: string): number {
  let n = 0;
  while (line[n] === ' ') n += 1;
  return n;
}

interface Fence {
  mark: string;
  size: number;
  indent: number;
  info: string;
}

function fenceOf(line: string): Fence | undefined {
  const indent = indentOf(line);
  if (indent > 3) return undefined;
  const mark = line[indent];
  if (mark !== '`' && mark !== '~') return undefined;
  let size = 0;
  while (line[indent + size] === mark) size += 1;
  if (size < 3) return undefined;
  const info = line.slice(indent + size).trim();
  // A line of inline code is no fence.
  if (mark === '`' && info.includes('`')) return undefined;
  return { mark, size, indent, info };
}

function closesFence(line: string, fence: Fence): boolean {
  const indent = indentOf(line);
  if (indent > 3) return false;
  let size = 0;
  while (line[indent + size] === fence.mark) size += 1;
  return size >= fence.size && line.slice(indent + size).trim() === '';
}

function headingOf(line: string): { level: number; text: string } | undefined {
  const indent = indentOf(line);
  if (indent > 3) return undefined;
  let level = 0;
  while (line[indent + level] === '#') level += 1;
  if (level < 1 || level > 6) return undefined;
  const after = line[indent + level];
  if (after !== undefined && after !== ' ') return undefined;
  let text = line.slice(indent + level).trim();
  // "## Title ##": the closing marks are not part of the title.
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === ' ')) text = text.slice(0, end).trim();
  return { level, text };
}

function isRule(line: string): boolean {
  if (indentOf(line) > 3) return false;
  let mark: string | undefined;
  let count = 0;
  for (const c of line) {
    if (c === ' ') continue;
    if (c !== '-' && c !== '*' && c !== '_') return false;
    if (mark !== undefined && c !== mark) return false;
    mark = c;
    count += 1;
  }
  return count >= 3;
}

function isQuote(line: string): boolean {
  const indent = indentOf(line);
  return indent <= 3 && line[indent] === '>';
}

interface Marker {
  ordered: boolean;
  /** The number an ordered item carries. */
  number: number;
  indent: number;
  /** Where the item's text begins on the line. */
  width: number;
}

function markerOf(line: string): Marker | undefined {
  const indent = indentOf(line);
  if (indent > 3) return undefined;
  let at = indent;
  let ordered = false;
  let number = 1;
  const c = line[at];
  if (c === '-' || c === '*' || c === '+') {
    at += 1;
  } else {
    let digits = 0;
    while (digits < 9 && line[at + digits] !== undefined && /[0-9]/.test(line[at + digits]!)) {
      digits += 1;
    }
    if (digits === 0) return undefined;
    const close = line[at + digits];
    if (close !== '.' && close !== ')') return undefined;
    ordered = true;
    number = Number(line.slice(at, at + digits));
    at += digits + 1;
  }
  if (line[at] !== ' ') return undefined;
  let spaces = 0;
  while (line[at + spaces] === ' ') spaces += 1;
  // A marker with nothing after it is shown as written: "-" or "1." alone is no list.
  if (line[at + spaces] === undefined) return undefined;
  // More than four spaces after the marker begin an indented block inside the item.
  const width = at + (spaces > 4 ? 1 : spaces);
  return { ordered, number, indent, width };
}

/** Whether a line begins something other than a paragraph, and so ends the one before it. */
function interrupts(line: string): boolean {
  if (fenceOf(line) || headingOf(line) || isRule(line) || isQuote(line)) return true;
  const marker = markerOf(line);
  // As in CommonMark: a numbered list can cut into a paragraph only when it begins at 1.
  return marker !== undefined && (!marker.ordered || marker.number === 1);
}

function blocks(source: string[], depth: number): Block[] {
  if (depth > MAX_DEPTH) {
    const text = source.join('\n').trim();
    return text === '' ? [] : [{ kind: 'paragraph', children: lines(text) }];
  }
  const out: Block[] = [];
  let i = 0;
  while (i < source.length) {
    const line = source[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < source.length && !closesFence(source[i] ?? '', fence)) {
        const row = source[i] ?? '';
        body.push(row.slice(Math.min(indentOf(row), fence.indent)));
        i += 1;
      }
      // The closing fence; a fence left open runs to the end.
      i += 1;
      const language = /^[A-Za-z0-9_+#.-]{1,24}/.exec(fence.info)?.[0];
      out.push({ kind: 'code', text: body.join('\n'), ...(language ? { language } : {}) });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      out.push({ kind: 'heading', level: heading.level, children: inline(heading.text) });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      out.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const inner: string[] = [];
      while (i < source.length && isQuote(source[i] ?? '')) {
        const row = source[i] ?? '';
        const at = indentOf(row) + 1;
        inner.push(row.slice(row[at] === ' ' ? at + 1 : at));
        i += 1;
      }
      out.push({ kind: 'quote', children: blocks(inner, depth + 1) });
      continue;
    }

    const first = markerOf(line);
    if (first) {
      const items: Block[][] = [];
      let marker: Marker | undefined = first;
      while (marker) {
        const current: Marker = marker;
        const item: string[] = [(source[i] ?? '').slice(current.width)];
        i += 1;
        marker = undefined;
        while (i < source.length) {
          const row = source[i] ?? '';
          if (row.trim() === '') {
            // A blank line stays in the item when what follows it is still the item's.
            let next = i + 1;
            while (next < source.length && (source[next] ?? '').trim() === '') next += 1;
            const after = source[next];
            if (after !== undefined && indentOf(after) >= current.width) {
              for (; i < next; i += 1) item.push('');
              continue;
            }
            const sibling = after === undefined ? undefined : markerOf(after);
            if (sibling && sibling.ordered === first.ordered && !isRule(after ?? '')) {
              i = next;
              marker = sibling;
            }
            break;
          }
          if (indentOf(row) >= current.width) {
            item.push(row.slice(current.width));
            i += 1;
            continue;
          }
          const sibling = isRule(row) ? undefined : markerOf(row);
          if (sibling) {
            if (sibling.ordered === first.ordered) marker = sibling;
            break;
          }
          // A line of the paragraph above, written without its indent.
          if ((item[item.length - 1] ?? '').trim() !== '' && !interrupts(row)) {
            item.push(row.trim());
            i += 1;
            continue;
          }
          break;
        }
        items.push(blocks(item, depth + 1));
      }
      out.push({
        kind: 'list',
        ordered: first.ordered,
        start: first.ordered ? first.number : 1,
        items,
      });
      continue;
    }

    const text: string[] = [line.trim()];
    i += 1;
    while (i < source.length) {
      const row = source[i] ?? '';
      if (row.trim() === '' || interrupts(row)) break;
      text.push(row.trim());
      i += 1;
    }
    out.push({ kind: 'paragraph', children: inline(text.join('\n')) });
  }
  return out;
}

// ---- inline ---------------------------------------------------------------------------

interface Delimiter {
  kind: 'delimiter';
  char: '*' | '_';
  count: number;
  open: boolean;
  close: boolean;
}

type Token = Inline | Delimiter;

const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

/** The marks a backslash makes plain: "\*" is a star. */
const ESCAPABLE = new Set('*_`[]');

/**
 * Whether the backslash at `at` follows a Windows path on its line and so is the path's own:
 * "Config\Input\*.diff.lua" must not lose a separator. A path matters more here than a mark.
 */
function inPath(s: string, at: number): boolean {
  let before = s.slice(Math.max(0, at - 260), at);
  const line = before.lastIndexOf('\n');
  if (line >= 0) before = before.slice(line + 1);
  return /[A-Za-z]:$/.test(before) || /\\[A-Za-z0-9{]/.test(before);
}

function isPunctuation(c: string | undefined): boolean {
  return c !== undefined && PUNCTUATION.has(c);
}

/** Where a run of exactly `size` backticks begins at or after `from`; -1 when there is none. */
function closingTicks(s: string, from: number, size: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (s[i + run] === '`') run += 1;
    if (run === size) return i;
    i += run;
  }
  return -1;
}

/** `[label](address "title")` from the `[` at `at`: the label, the address and where it ends. */
function linkAt(s: string, at: number): { label: string; dest: string; end: number } | undefined {
  let depth = 0;
  let close = -1;
  const limit = Math.min(s.length, at + MAX_LABEL + 2);
  for (let i = at; i < limit; i += 1) {
    const c = s[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0 || s[close + 1] !== '(') return undefined;
  let i = close + 2;
  while (s[i] === ' ' || s[i] === '\n') i += 1;
  let dest = '';
  if (s[i] === '<') {
    const end = s.indexOf('>', i);
    if (end < 0 || end - i > MAX_LINK) return undefined;
    dest = s.slice(i + 1, end);
    i = end + 1;
  } else {
    const begin = i;
    let parens = 0;
    while (i < s.length && i - begin <= MAX_LINK) {
      const c = s[i];
      if (isSpace(c)) break;
      if (c === '(') parens += 1;
      if (c === ')') {
        if (parens === 0) break;
        parens -= 1;
      }
      i += 1;
    }
    dest = s.slice(begin, i);
  }
  while (s[i] === ' ' || s[i] === '\n') i += 1;
  // A title in quotes is allowed and not used.
  const quote = s[i];
  if (quote === '"' || quote === "'") {
    const end = s.indexOf(quote, i + 1);
    if (end < 0 || end - i > MAX_LABEL) return undefined;
    i = end + 1;
    while (s[i] === ' ' || s[i] === '\n') i += 1;
  }
  if (s[i] !== ')') return undefined;
  return { label: s.slice(at + 1, close), dest, end: i + 1 };
}

/** Whether a label reads like a web address itself: then it must be the one the link leads to. */
function looksLikeAddress(label: string): boolean {
  const text = label.trim();
  if (text === '' || text.includes(' ')) return false;
  return /^(https?:\/\/|www\.)/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
}

function hostOf(text: string): string | undefined {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname;
  } catch {
    // Not an address: it names no host.
    return undefined;
  }
}

function linkToken(label: string, href: string): Inline {
  const shown = label.trim();
  const host = hostOf(href) ?? '';
  // "[rigready.io](https://elsewhere.example)", or a host written in letters that only look
  // like the ones they stand for: the address it really leads to is what is shown.
  if (
    shown === '' ||
    host.includes('xn--') ||
    (looksLikeAddress(shown) && hostOf(shown) !== host)
  ) {
    return { kind: 'link', href, children: [{ kind: 'text', text: href }] };
  }
  return { kind: 'link', href, children: inline(shown, true) };
}

/** An address written out is shown as written when it is plain ASCII, as it resolves otherwise. */
function writtenLink(text: string, href: string): Inline {
  const shown = /^[!-~]+$/.test(text) ? text : href;
  return { kind: 'link', href, children: [{ kind: 'text', text: shown }] };
}

/** A web address written out in the text, from `at`: up to the first space, without the sentence's own marks. */
function bareLink(s: string, at: number): { href: string; text: string; end: number } | undefined {
  let end = at;
  while (end < s.length && end - at <= MAX_LINK) {
    const c = s[end];
    if (isSpace(c) || c === '<' || c === '>' || c === '"' || c === '`') break;
    end += 1;
  }
  // "(see https://rigready.io/docs/)." ends before the bracket and the full stop.
  for (;;) {
    const last = s[end - 1];
    if (last === undefined || end <= at) break;
    if ('.,;:!?\'"*_~'.includes(last)) {
      end -= 1;
      continue;
    }
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const text = s.slice(at, end);
      if (text.split(open).length < text.split(last).length) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  const text = s.slice(at, end);
  const href = safeLink(text);
  return href ? { href, text, end } : undefined;
}

function inline(s: string, inLink = false): Inline[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') tokens.push({ kind: 'text', text });
    text = '';
  };
  /** Searches that already failed once from further left: they cannot succeed further right. */
  const dead = new Set<string>();
  /** No label can close after this. */
  const lastBracket = inLink ? -1 : s.lastIndexOf(']');
  let delimiters = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i] ?? '';
    const escaped = c === '\\' ? s[i + 1] : undefined;
    if (escaped !== undefined && ESCAPABLE.has(escaped)) {
      // Either way the mark is plain text; in a path the backslash stays too.
      text += inPath(s, i) ? c + escaped : escaped;
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      tokens.push({ kind: 'break' });
      i += 1;
      continue;
    }
    if (c === '`') {
      let size = 0;
      while (s[i + size] === '`') size += 1;
      const key = `\`${size}`;
      const close = dead.has(key) ? -1 : closingTicks(s, i + size, size);
      if (close < 0) {
        dead.add(key);
        text += s.slice(i, i + size);
        i += size;
        continue;
      }
      let code = s.slice(i + size, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      flush();
      tokens.push({ kind: 'code', text: code });
      i = close + size;
      continue;
    }
    if (c === '*' || c === '_') {
      let count = 0;
      while (s[i + count] === c) count += 1;
      const before = s[i - 1];
      const after = s[i + count];
      const left =
        !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
      const right =
        !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
      // An underscore inside a word is part of the word: setup_read, process_running.
      const open = c === '*' ? left : left && (!right || isPunctuation(before));
      const close = c === '*' ? right : right && (!left || isPunctuation(after));
      flush();
      tokens.push({ kind: 'delimiter', char: c, count, open, close });
      delimiters += 1;
      i += count;
      continue;
    }
    if (!inLink && (c === '[' || (c === '!' && s[i + 1] === '['))) {
      // An image is never loaded: it is shown as a link to it.
      const at = c === '!' ? i + 1 : i;
      const found = at < lastBracket ? linkAt(s, at) : undefined;
      const href = found ? safeLink(found.dest) : undefined;
      if (found && href) {
        flush();
        tokens.push(linkToken(found.label, href));
        i = found.end;
        continue;
      }
      text += c;
      i += 1;
      continue;
    }
    if (!inLink && c === '<' && /^<https?:\/\//i.test(s.slice(i, i + 9))) {
      const end = s.indexOf('>', i);
      const href = end > 0 && end - i <= MAX_LINK ? safeLink(s.slice(i + 1, end)) : undefined;
      if (href) {
        flush();
        tokens.push(writtenLink(s.slice(i + 1, end), href));
        i = end + 1;
        continue;
      }
    }
    if (
      !inLink &&
      (c === 'h' || c === 'H') &&
      /^https?:\/\//i.test(s.slice(i, i + 8)) &&
      !/[A-Za-z0-9]/.test(s[i - 1] ?? ' ')
    ) {
      const found = bareLink(s, i);
      if (found) {
        flush();
        tokens.push(writtenLink(found.text, found.href));
        i = found.end;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return delimiters > MAX_DELIMITERS ? settle(tokens) : emphasis(tokens);
}

/** How deep bold and italics are nested in a node. */
const nesting = new WeakMap<object, number>();

function nestingOf(children: Inline[]): number {
  let deepest = 0;
  for (const child of children) deepest = Math.max(deepest, nesting.get(child) ?? 0);
  return deepest;
}

/**
 * Pairs the runs of * and _ into bold and italics: each run that can close looks back for
 * the nearest run of its kind that can open (the way CommonMark does it).
 */
function emphasis(tokens: Token[]): Inline[] {
  let i = 0;
  while (i < tokens.length) {
    const closer = tokens[i];
    if (!closer || closer.kind !== 'delimiter' || !closer.close || closer.count === 0) {
      i += 1;
      continue;
    }
    let found = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const t = tokens[j];
      if (!t || t.kind !== 'delimiter' || !t.open || t.char !== closer.char || t.count === 0) {
        continue;
      }
      // CommonMark's rule of three: "*a**b*" is one italic, not a bold cut in two.
      const both = t.close || closer.open;
      const sum = t.count + closer.count;
      if (both && sum % 3 === 0 && !(t.count % 3 === 0 && closer.count % 3 === 0)) continue;
      found = j;
      break;
    }
    if (found < 0) {
      i += 1;
      continue;
    }
    const opener = tokens[found] as Delimiter;
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const children = settle(tokens.slice(found + 1, i));
    const deep = nestingOf(children) + 1;
    let node: Inline;
    if (deep > MAX_NESTING) {
      node = { kind: 'text', text: plainText(children) };
    } else {
      node = { kind: use === 2 ? 'strong' : 'em', children };
      nesting.set(node, deep);
    }
    opener.count -= use;
    closer.count -= use;
    tokens.splice(found + 1, i - found - 1, node);
    i = found + 2;
    if (opener.count === 0) {
      tokens.splice(found, 1);
      i -= 1;
    }
    if (closer.count === 0) tokens.splice(i, 1);
  }
  return settle(tokens);
}

/** What is left of the runs is text; pieces of text side by side become one. */
function settle(tokens: Token[]): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens) {
    const node: Inline =
      token.kind === 'delimiter' ? { kind: 'text', text: token.char.repeat(token.count) } : token;
    if (node.kind === 'text' && node.text === '') continue;
    const last = out[out.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + node.text };
    } else {
      out.push(node);
    }
  }
  return out;
}
