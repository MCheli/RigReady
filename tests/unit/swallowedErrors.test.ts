import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

/**
 * Errors are not swallowed (PLAT-010). Every place in src/ that catches something and
 * throws the error away must either turn it into an error of its own (return err(...),
 * throw, set a message) or say why nothing needs reporting, in a comment inside the
 * block (for a one-line `.catch(() => ...)`: on that line or the line before). A new
 * silent catch without that sentence fails this test.
 *
 * "Throws the error away" means: a `catch` without a binding, or one whose binding is
 * never used in the block; and a `.catch(() => ...)` whose callback takes no argument.
 */

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await sourceFiles(full)));
    } else if (/\.(ts|vue)$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The text with the contents of string literals blanked, so code inside a string is not code. */
function withoutStrings(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i) + 2;
      const stop = end < (next === '/' ? 0 : 2) ? text.length : end;
      out += text.slice(i, stop);
      i = stop - 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let body = '';
      let j = i + 1;
      // A quote that is not closed on its line was not a string (an apostrophe in a regex).
      for (; j < text.length && text[j] !== ch; j++) {
        if (text[j] === '\n' && ch !== '`') break;
        if (text[j] === '\\') {
          body += '  ';
          j++;
        } else {
          body += text[j] === '\n' ? '\n' : ' ';
        }
      }
      if (text[j] === ch) {
        out += ch + body + ch;
        i = j;
      } else {
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Index of the brace that closes the block opened at `open` (in text without strings). */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) return -1;
    } else if (ch === '/' && next === '*') {
      i = text.indexOf('*/', i) + 1;
      if (i <= 0) return -1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

const hasComment = (text: string): boolean => /\/\/|\/\*/.test(text);

/** The block turns the failure into an error of its own: it returns err(...), throws, or sets a message. */
const reportsIt = (body: string): boolean => /\berr\(|\bthrow\b|addIssue|Error\b/.test(body);

/** Silent catches in one source text: line number and the offending line. */
function silentCatches(source: string): { line: number; text: string }[] {
  const text = withoutStrings(source);
  const sourceLines = source.split('\n');
  const found: { line: number; text: string }[] = [];
  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
  const lineText = (index: number): string => (sourceLines[lineOf(index) - 1] ?? '').trim();

  // try { ... } catch { ... } and catch (e) { ... }
  for (const match of text.matchAll(/\bcatch\s*(?:\(\s*(\w+)[^)]*\))?\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = closingBrace(text, open);
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    const binding = match[1];
    const used = binding !== undefined && new RegExp('\\b' + binding + '\\b').test(body);
    if (!used && !hasComment(body) && !reportsIt(body)) {
      found.push({ line: lineOf(match.index), text: lineText(match.index) });
    }
  }

  // promise.catch(() => fallback): the rejection is dropped.
  for (const match of text.matchAll(/\.catch\(\s*\(\s*\)\s*=>/g)) {
    const end = text.indexOf('\n', match.index);
    const start = text.lastIndexOf('\n', match.index) + 1;
    const here = text.slice(start, end < 0 ? text.length : end);
    const before = text.slice(text.lastIndexOf('\n', start - 2) + 1, start);
    // The reason is on the same line, on the line before, or inside the callback's block.
    const after = text.slice(match.index, match.index + 600);
    const block = /^\.catch\(\s*\(\s*\)\s*=>\s*\{/.test(after)
      ? after.slice(0, closingBrace(after, after.indexOf('{')) + 1)
      : '';
    if (!hasComment(here) && !/^\s*(\/\/|\*|\/\*)/.test(before) && !hasComment(block)) {
      found.push({ line: lineOf(match.index), text: lineText(match.index) });
    }
  }
  return found;
}

describe('errors are not swallowed', () => {
  it('finds a silent catch and accepts one that reports or says why', () => {
    expect(silentCatches('try { a(); } catch { }')).toHaveLength(1);
    expect(silentCatches('try { a(); } catch (e) { return undefined; }')).toHaveLength(1);
    expect(silentCatches('try { a(); } catch (e) { log.error("x", e); }')).toEqual([]);
    expect(silentCatches('try { a(); } catch { return err("x", "Not valid."); }')).toEqual([]);
    expect(silentCatches('try { a(); } catch { throw new Error("must be JSON"); }')).toEqual([]);
    expect(silentCatches('try { a(); } catch { jsonError.value = "Not valid yet"; }')).toEqual([]);
    expect(silentCatches('try { a(); } catch {\n  // Not there: nothing to restore.\n}')).toEqual(
      []
    );
    expect(silentCatches('const x = await read().catch(() => undefined);')).toEqual([
      { line: 1, text: 'const x = await read().catch(() => undefined);' },
    ]);
    expect(
      silentCatches('// A missing file is an empty list.\nconst x = await read().catch(() => []);')
    ).toEqual([]);
    expect(silentCatches('p.catch(() => {\n  // The log itself failed.\n  n++;\n});')).toEqual([]);
    expect(silentCatches('p.catch(() => {\n  n++;\n});')).toHaveLength(1);
    expect(silentCatches('p.catch((e) => log.warn("x", e));')).toEqual([]);
    // Code inside a string is not code; a comment marker inside a string is not a comment.
    expect(silentCatches('const s = "catch { }";')).toEqual([]);
    expect(silentCatches('try { a(); } catch { return "http://x"; }')).toHaveLength(1);
    expect(silentCatches("const quote = /'/;\ntry { a(); } catch { return 1; }")).toEqual([
      { line: 2, text: 'try { a(); } catch { return 1; }' },
    ]);
  });

  it('every catch in src/ that drops the error says why', async () => {
    const src = path.join(repoRoot, 'src');
    const findings: string[] = [];
    let files = 0;
    for (const file of await sourceFiles(src)) {
      files++;
      const text = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
      for (const found of silentCatches(text)) {
        const name = path.relative(repoRoot, file).replace(/\\/g, '/');
        findings.push(`${name}:${found.line}  ${found.text}`);
      }
    }
    expect(files).toBeGreaterThan(150);
    expect(findings).toEqual([]);
  });
});
