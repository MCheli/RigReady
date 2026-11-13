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
/**
 * How far a reply may be read ahead of its place to find where a link ends: this many
 * characters for each of its own, and this many besides. A reply written to be read needs
 * about one for each of its own. Once they are spent, the rest of the reply is shown as
 * written and no more links are made in it.
 */
const LOOKS_PER_CHARACTER = 8;
const LOOKS_BESIDES = 10_000;

/** Marks that turn the direction of text around: they can make an address read as another. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
/** Control characters other than the line break. */
const CONTROL = /[^\P{Cc}\n]/gu;

/**
 * The work of the parse under way, in steps: one for each character read, and one more each
 * time a character or a run is read again. How long a parse takes depends on the machine; the
 * steps do not, so the tests hold the parser to them.
 */
let steps = 0;
/** The steps spent reading ahead for the end of a link, and how many this reply may spend. */
let looked = 0;
let allowance = 0;

function look(characters: number): void {
  looked += characters;
  steps += characters;
}

/** Whether the reply has read ahead all it may: from here on no link is made in it. */
function spent(): boolean {
  return looked > allowance;
}

/** A reply parsed, with the steps it took. */
export function measureMarkdown(source: string): { tree: Block[]; steps: number } {
  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(BIDI, '')
    .replace(CONTROL, '');
  steps = text.length;
  looked = 0;
  allowance = LOOKS_BESIDES + LOOKS_PER_CHARACTER * text.length;
  const tree = text.length > MAX_MARKDOWN ? plain(text) : blocks(text.split('\n'), 0);
  return { tree, steps };
}

export function parseMarkdown(source: string): Block[] {
  return measureMarkdown(source).tree;
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
  if (c === undefined) return true;
  const code = c.charCodeAt(0);
  // Asked of every character of an address: the plain ones are settled without the pattern.
  if (code < 128) return code === 32 || (code >= 9 && code <= 13);
  return /\s/.test(c);
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
  for (const line of source) steps += line.length + 1;
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

/** Where the last run of each length of backticks begins: a run is closed only before it. */
function tickRuns(s: string): Map<number, number> {
  const last = new Map<number, number>();
  let i = s.indexOf('`');
  while (i >= 0) {
    let run = 0;
    while (s[i + run] === '`') run += 1;
    last.set(run, i);
    i = s.indexOf('`', i + run);
  }
  steps += s.length;
  return last;
}

/**
 * For each "[" of the text, where the "]" that closes it is; -1 everywhere else. A backslash
 * takes the character after it out of the count. One pass over the text, so that no label is
 * looked for twice.
 */
function closingBrackets(s: string): Int32Array {
  const closes = new Int32Array(s.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      open.push(i);
    } else if (c === ']') {
      const from = open.pop();
      if (from !== undefined) closes[from] = i;
    }
  }
  steps += s.length;
  return closes;
}

/** Where `mark` first is from `from`, no more than `reach` characters on; -1 when it is not. */
function within(s: string, mark: string, from: number, reach: number): number {
  const at = s.slice(from, from + reach + 1).indexOf(mark);
  look(at < 0 ? Math.min(reach, s.length - from) : at);
  return at < 0 ? -1 : from + at;
}

/** The first place from `from` that is not a space or a line break. */
function pastSpaces(s: string, from: number): number {
  let i = from;
  while (s[i] === ' ' || s[i] === '\n') i += 1;
  look(i - from);
  return i;
}

/**
 * The rest of `[label](address "title")` from the "]" at `close`: the address, and where the
 * link ends.
 */
function linkAt(s: string, close: number): { dest: string; end: number } | undefined {
  if (s[close + 1] !== '(') return undefined;
  let i = pastSpaces(s, close + 2);
  let dest = '';
  if (s[i] === '<') {
    const end = within(s, '>', i, MAX_LINK);
    if (end < 0) return undefined;
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
    look(i - begin);
    dest = s.slice(begin, i);
  }
  i = pastSpaces(s, i);
  // A title in quotes is allowed and not used.
  const quote = s[i];
  if (quote === '"' || quote === "'") {
    const end = within(s, quote, i + 1, MAX_LABEL - 1);
    if (end < 0) return undefined;
    i = pastSpaces(s, end + 1);
  }
  return s[i] === ')' ? { dest, end: i + 1 } : undefined;
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
  // How many more closing brackets than opening ones the address holds, of each shape.
  let round = 0;
  let square = 0;
  while (end < s.length && end - at <= MAX_LINK) {
    const c = s[end];
    if (isSpace(c) || c === '<' || c === '>' || c === '"' || c === '`') break;
    if (c === '(') round -= 1;
    else if (c === ')') round += 1;
    else if (c === '[') square -= 1;
    else if (c === ']') square += 1;
    end += 1;
  }
  look(end - at);
  // "(see https://rigready.io/docs/)." ends before the bracket and the full stop.
  for (;;) {
    const last = s[end - 1];
    if (last === undefined || end <= at) break;
    if ('.,;:!?\'"*_~'.includes(last)) {
      end -= 1;
      continue;
    }
    // A closing bracket that nothing in the address opens is the sentence's.
    if (last === ')' && round > 0) {
      round -= 1;
      end -= 1;
      continue;
    }
    if (last === ']' && square > 0) {
      square -= 1;
      end -= 1;
      continue;
    }
    break;
  }
  const text = s.slice(at, end);
  const href = safeLink(text);
  return href ? { href, text, end } : undefined;
}

function inline(s: string, inLink = false): Inline[] {
  steps += s.length;
  const tokens: Token[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') tokens.push({ kind: 'text', text });
    text = '';
  };
  /** Where the last run of each length of backticks begins, found at the first backtick. */
  let lastTicks: Map<number, number> | undefined;
  /** Where the "]" of each "[" is, found at the first "[". */
  let closes: Int32Array | undefined;
  /** The last ")" and the last ">": past them no link can end. */
  let lastParen = -1;
  let lastAngle: number | undefined;
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
      lastTicks ??= tickRuns(s);
      // A run this long further on closes it; without one the backticks are text.
      const close = (lastTicks.get(size) ?? -1) > i ? closingTicks(s, i + size, size) : -1;
      if (close < 0) {
        text += s.slice(i, i + size);
        i += size;
        continue;
      }
      steps += close - i;
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
    // A reply that has read ahead all it may is shown as written from here on.
    const links = !inLink && !spent();
    if (links && (c === '[' || (c === '!' && s[i + 1] === '['))) {
      // An image is never loaded: it is shown as a link to it.
      const at = c === '!' ? i + 1 : i;
      if (!closes) {
        closes = closingBrackets(s);
        lastParen = s.lastIndexOf(')');
      }
      const close = closes[at] ?? -1;
      // A label has a length, and its link ends in a ")" further on.
      const found =
        close > at && close - at <= MAX_LABEL + 1 && close + 1 < lastParen
          ? linkAt(s, close)
          : undefined;
      const href = found ? safeLink(found.dest) : undefined;
      if (found && href) {
        flush();
        tokens.push(linkToken(s.slice(at + 1, close), href));
        i = found.end;
        continue;
      }
      // "![" that is no image is no link either: both marks are text.
      text += s.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    if (links && c === '<' && /^<https?:\/\//i.test(s.slice(i, i + 9))) {
      lastAngle ??= s.lastIndexOf('>');
      const end = i < lastAngle ? within(s, '>', i, MAX_LINK) : -1;
      const href = end > 0 ? safeLink(s.slice(i + 1, end)) : undefined;
      if (href) {
        flush();
        tokens.push(writtenLink(s.slice(i + 1, end), href));
        i = end + 1;
        continue;
      }
    }
    if (
      links &&
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
  /** What has been read so far, with its pairs made. Only its end ever changes. */
  const read: Token[] = [];
  /**
   * For each kind of closing run, the place below which nothing opens for it: a search that
   * found nothing is not made again over the same runs (CommonMark's "openers bottom").
   */
  const floors = new Map<string, number>();
  for (const token of tokens) {
    // A run that can close does so as long as it has marks left and finds a run to open it.
    while (token.kind === 'delimiter' && token.close && token.count > 0) {
      // All that a run's opening for this one depends on, besides the run itself.
      const kind = `${token.char}${token.count % 3}${token.open}`;
      const floor = floors.get(kind) ?? 0;
      let found = -1;
      for (let j = read.length - 1; j >= floor; j -= 1) {
        const t = read[j];
        if (!t || t.kind !== 'delimiter' || !t.open || t.char !== token.char) continue;
        // CommonMark's rule of three: "*a**b*" is one italic, not a bold cut in two.
        const both = t.close || token.open;
        const sum = t.count + token.count;
        if (both && sum % 3 === 0 && !(t.count % 3 === 0 && token.count % 3 === 0)) continue;
        found = j;
        break;
      }
      steps += read.length - Math.max(found, floor);
      if (found < 0) {
        floors.set(kind, read.length);
        break;
      }
      // The opener changes now, and may open where it could not: nothing above it is settled.
      for (const [key, at] of floors) if (at > found) floors.set(key, found);
      const opener = read[found] as Delimiter;
      const use = opener.count >= 2 && token.count >= 2 ? 2 : 1;
      const children = settle(read.splice(found + 1));
      const deep = nestingOf(children) + 1;
      let node: Inline;
      if (deep > MAX_NESTING) {
        node = { kind: 'text', text: plainText(children) };
      } else {
        node = { kind: use === 2 ? 'strong' : 'em', children };
        nesting.set(node, deep);
      }
      opener.count -= use;
      token.count -= use;
      if (opener.count === 0) read.pop();
      read.push(node);
    }
    // A run with marks left stays, to open for a later one or to be text.
    if (token.kind !== 'delimiter' || token.count > 0) read.push(token);
  }
  return settle(read);
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
