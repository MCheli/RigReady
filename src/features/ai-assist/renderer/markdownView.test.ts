import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVNode, type VNode } from 'vue';
import { parseMarkdown } from '../core/markdown';
import { MarkdownText, openLink, renderBlocks } from './markdownView';

/**
 * What a reply becomes on the page. The view builds Vue nodes from the parsed reply; these
 * tests walk the nodes the real code makes and pin that only a short list of plain elements
 * ever comes out, that the model's text is only ever text, and that a link can only be an
 * https address opened in the system browser.
 */

const ALLOWED = new Set([
  'div',
  'p',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'br',
  'a',
]);
/** The only attributes the view ever sets, by element. */
const PROPS: Record<string, string[]> = {
  a: ['class', 'href', 'title', 'target', 'rel', 'onClick'],
  div: ['class', 'role', 'aria-level'],
  code: ['class'],
  pre: ['class', 'tabindex', 'data-language'],
  ol: ['start'],
};

interface Seen {
  tags: string[];
  text: string;
  links: VNode[];
}

function walk(nodes: unknown, seen: Seen = { tags: [], text: '', links: [] }): Seen {
  if (typeof nodes === 'string') {
    seen.text += nodes;
    return seen;
  }
  if (Array.isArray(nodes)) {
    for (const node of nodes) walk(node, seen);
    return seen;
  }
  if (!isVNode(nodes)) throw new Error(`Neither text nor a node: ${String(nodes)}`);
  const tag = nodes.type;
  if (typeof tag !== 'string') throw new Error('A component or fragment came out of the view');
  if (!ALLOWED.has(tag)) throw new Error(`<${tag}> came out of the view`);
  for (const prop of Object.keys(nodes.props ?? {})) {
    if (!(PROPS[tag] ?? []).includes(prop)) throw new Error(`<${tag}> carries ${prop}`);
  }
  seen.tags.push(tag);
  if (tag === 'a') seen.links.push(nodes);
  if (nodes.children !== null) walk(nodes.children, seen);
  return seen;
}

const view = (source: string): Seen => walk(renderBlocks(parseMarkdown(source)));

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('ASSIST-001 a reply on the page', () => {
  it('shows the common Markdown as plain elements', () => {
    const seen = view(
      [
        '## TrackIR',
        'It is **not** required, only *recommended*: see `setup_read`.',
        '- one\n- two\n  1. inner',
        '3. three\n4. four',
        '```lua\nreturn 1 < 2\n```',
        '> quoted',
        '---',
      ].join('\n\n')
    );
    expect(seen.tags).toEqual([
      'div',
      'p',
      'strong',
      'em',
      'code',
      'ul',
      'li',
      'p',
      'li',
      'p',
      'ol',
      'li',
      'p',
      'ol',
      'li',
      'p',
      'li',
      'p',
      'pre',
      'code',
      'blockquote',
      'p',
      'hr',
    ]);
    expect(seen.text).toContain('TrackIR');
    expect(seen.text).toContain('return 1 < 2');
    const blocks = renderBlocks(parseMarkdown('### Title\n\n3. three\n\n```lua\nx\n```'));
    expect(blocks[0]?.props).toMatchObject({ role: 'heading', 'aria-level': 5 });
    expect(blocks[1]?.props).toEqual({ start: 3 });
    expect(blocks[2]?.props).toMatchObject({ 'data-language': 'lua' });
  });

  it('keeps every piece of the reply as text: markup in it is never made into elements', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<style>* { display: none }</style>',
      '<div v-html="x" onclick="steal()">{{ constructor.constructor("alert(1)")() }}</div>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    ];
    for (const source of hostile) {
      const seen = view(source);
      expect(seen.tags, source).toEqual(['p']);
      expect(seen.text, source).toBe(source);
    }
    // Inside emphasis, code, lists and quotes too.
    const nested = view(
      '**<b onmouseover=x>**\n\n- `<script>`\n\n> <svg onload=x>\n\n```html\n<script>alert(1)</script>\n```'
    );
    expect(nested.tags).not.toContain('a');
    expect(nested.text).toContain('<b onmouseover=x>');
    expect(nested.text).toContain('<script>alert(1)</script>');
  });

  it('makes a link of an https address only, opened in the system browser and never in the window', () => {
    const open = vi.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open } });
    const seen = view('See [the manual](https://rigready.io/docs/ai/built-in-assistant/) now.');
    expect(seen.links).toHaveLength(1);
    const link = seen.links[0]!;
    expect(link.props).toMatchObject({
      href: 'https://rigready.io/docs/ai/built-in-assistant/',
      // The address a link really goes to can always be read before it is pressed.
      title: 'https://rigready.io/docs/ai/built-in-assistant/',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    const event = { preventDefault: vi.fn() };
    (link.props as { onClick: (e: unknown) => void }).onClick(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://rigready.io/docs/ai/built-in-assistant/',
      '_blank',
      'noopener'
    );

    // Anything else is never handed to the system, whatever asks.
    openLink('http://example.com/');
    openLink('javascript:alert(1)');
    openLink('file:///C:/Windows/System32/calc.exe');
    openLink('rigready://run');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows an http address as text with the address, and no other scheme as a link at all', () => {
    const plainHttp = view('Read [the forum](http://forum.example/t/1) or http://forum.example/x');
    expect(plainHttp.links).toEqual([]);
    expect(plainHttp.text).toBe(
      'Read the forum (http://forum.example/t/1) or http://forum.example/x'
    );
    for (const source of [
      '[x](javascript:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](file:///C:/Users/me/secret.txt)',
      '[x](rigready://profiles/delete)',
      '[x](//evil.example/a)',
      '[x](https://user:pw@evil.example/)',
      '![x](https://evil.example/pixel.png "t")',
    ]) {
      const seen = view(source);
      for (const link of seen.links) {
        expect(String(link.props?.['href']), source).toMatch(/^https:\/\/[a-z0-9.-]+\//);
        expect(String(link.props?.['href']), source).not.toContain('@');
      }
      expect(
        seen.tags.filter((t) => t !== 'p' && t !== 'a'),
        source
      ).toEqual([]);
    }
    // An image is never loaded: at most a link to it, to press or not.
    expect(view('![x](https://evil.example/pixel.png)').tags).toEqual(['p', 'a']);
  });

  it('is one element with the reply in it, parsed again only when the reply changes', () => {
    const props = { source: 'Hello **there**' };
    const render = (
      MarkdownText as unknown as { setup: (p: { source: string }) => () => VNode }
    ).setup(props);
    const first = render();
    expect(first.type).toBe('div');
    expect(first.props).toEqual({ class: 'md' });
    const seen = walk(first);
    expect(seen.tags).toEqual(['div', 'p', 'strong']);
    expect(seen.text).toBe('Hello there');
  });
});
