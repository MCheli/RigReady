/**
 * NFR-006, in the source: no control is a stub. Every Vue file is scanned for buttons whose
 * click does nothing, handlers that are missing or empty, and the words a stub leaves
 * behind. (The running app is crawled in tests/e2e/nfr.e2e.ts.)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

async function sources(dir: string, extension: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await sources(full, extension)));
    } else if (extension.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string): string => path.relative(repoRoot, file).replace(/\\/g, '/');

interface Handler {
  file: string;
  line: number;
  event: string;
  code: string;
}

/** Every event handler in a template: @click="...", @update:model-value="...", v-on:x="...". */
function handlersOf(file: string, text: string): Handler[] {
  const template = /<template>([\s\S]*)<\/template>/.exec(text)?.[1] ?? '';
  const offset = text.indexOf(template);
  const found: Handler[] = [];
  for (const match of template.matchAll(/(?:@|v-on:)([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    const line = text.slice(0, offset + match.index).split('\n').length;
    found.push({ file, line, event: match[1]!, code: match[2]!.trim() });
  }
  return found;
}

/** The body of a function or arrow function declared in the script, when it can be found. */
function bodyOf(script: string, name: string): string | undefined {
  const declared = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)[^=]*=>\\s*\\{?`
  ).exec(script);
  if (!declared) return undefined;
  const start = declared.index + declared[0].length;
  if (!declared[0].endsWith('{')) return script.slice(start, script.indexOf('\n', start));
  let depth = 1;
  let at = start;
  while (depth > 0 && at < script.length) {
    if (script[at] === '{') depth++;
    else if (script[at] === '}') depth--;
    at++;
  }
  return script.slice(start, at - 1);
}

describe('NFR-006 no stubs behind controls', () => {
  it('no handler in any template is empty, and every handler named exists in its component and does something', async () => {
    const files = await sources(path.join(repoRoot, 'src'), /\.vue$/);
    expect(files.length).toBeGreaterThan(40);
    const problems: string[] = [];
    let handlers = 0;
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const script = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => m[1])
        .join('\n');
      for (const handler of handlersOf(relative(file), text)) {
        handlers++;
        const where = `${handler.file}:${handler.line} @${handler.event}`;
        const code = handler.code;
        if (code === '' || /^\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)$/.test(code)) {
          problems.push(`${where}: does nothing ("${code}")`);
          continue;
        }
        // A plain name, or a call of one: it must be a function of this component.
        const name = /^([A-Za-z_$][\w$]*)(?:\(.*\))?$/.exec(code)?.[1];
        if (!name || name === 'emit' || name === '$emit') continue;
        const body = bodyOf(script, name);
        if (body === undefined) {
          // A prop, a store action or a composable's function used by name.
          if (!new RegExp(`\\b${name}\\b`).test(script)) {
            problems.push(`${where}: "${name}" is not defined in this component`);
          }
          continue;
        }
        const meaningful = body
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '')
          .trim();
        if (meaningful === '' || /^(return;?|void 0;?|undefined;?)$/.test(meaningful)) {
          problems.push(`${where}: "${name}" has an empty body`);
        }
        if (/not implemented|coming soon/i.test(meaningful)) {
          problems.push(`${where}: "${name}" says it is not implemented`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(handlers).toBeGreaterThan(300);
    console.log(
      `  NFR-006: ${handlers} template handlers in ${files.length} components, none empty`
    );
  });

  it('nothing shipped says "not implemented", "coming soon", TODO or FIXME, in code, comments or text', async () => {
    const files = await sources(path.join(repoRoot, 'src'), /\.(vue|ts|html|css)$/);
    const hits: string[] = [];
    for (const file of files) {
      const lines = (await fs.readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (
          /not (yet )?implemented|coming soon|under construction|\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/i.test(
            line
          )
        ) {
          hits.push(`${relative(file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('no control is disabled for good: every `disabled` in a template depends on something', async () => {
    const files = await sources(path.join(repoRoot, 'src'), /\.vue$/);
    const dead: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        // The bare attribute (inside a tag on one line, or on a line of its own among the
        // attributes), or one bound to the constant true: never usable.
        if (/<[\w-]+[^>]*\sdisabled(\s|>|\/)/.test(line) || line.trim() === 'disabled') {
          dead.push(`${relative(file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
        if (/:disabled="\s*true\s*"/.test(line)) {
          dead.push(`${relative(file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(dead).toEqual([]);
  });

  it('every button in every template does something: a click handler, a link, a form, or the menu or dialog it opens', async () => {
    const files = await sources(path.join(repoRoot, 'src'), /\.vue$/);
    const inert: string[] = [];
    let buttons = 0;
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      // Every opening tag of a button, attributes over several lines included. A quoted
      // attribute value may hold a ">" (`v-if="selected.size > 0"`), so quotes are skipped whole.
      for (const match of text.matchAll(
        /<(v-btn|button)(?![\w-])((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
      )) {
        buttons++;
        const attributes = match[2]!;
        const acts =
          /(@click|v-on:click)(\.[\w.]+)?=/.test(attributes) ||
          /(^|\s):?(to|href)=/.test(attributes) ||
          /type="submit"/.test(attributes) ||
          // The activator of a menu, a dialog or a tooltip gets its handlers from the slot.
          /v-bind="[^"]+"/.test(attributes) ||
          // A member of a toggle group acts by its value.
          /(^|\s):?value=/.test(attributes);
        if (!acts) {
          const line = text.slice(0, match.index).split('\n').length;
          inert.push(
            `${relative(file)}:${line}: <${match[1]}${attributes.replace(/\s+/g, ' ').slice(0, 80)}>`
          );
        }
      }
    }
    expect(inert).toEqual([]);
    expect(buttons).toBeGreaterThan(200);
    console.log(`  NFR-006: ${buttons} buttons in the templates, each with an action`);
  });
});
