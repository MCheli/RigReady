import { describe, expect, it } from 'vitest';
import {
  MAX_MARKDOWN,
  parseMarkdown,
  plainText,
  safeLink,
  type Block,
  type Inline,
} from './markdown';

/**
 * What an assistant writes is shown formatted, and it is untrusted text: a page or a file
 * the model read can put words in its mouth. These tests pin the Markdown that is
 * understood, and that nothing in a reply can become markup, load anything or lead
 * anywhere but a plain web address.
 */

const text = (t: string): Inline => ({ kind: 'text', text: t });
const para = (...children: Inline[]): Block => ({ kind: 'paragraph', children });

/** Every node of a tree, blocks and inlines alike. */
function nodes(tree: (Block | Inline)[]): (Block | Inline)[] {
  const out: (Block | Inline)[] = [];
  const walk = (node: Block | Inline): void => {
    out.push(node);
    if (node.kind === 'list') node.items.forEach((item) => item.forEach(walk));
    else if ('children' in node) node.children.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}

const links = (source: string): string[] =>
  nodes(parseMarkdown(source)).flatMap((n) => (n.kind === 'link' ? [n.href] : []));

describe('the Markdown of a reply', () => {
  it('paragraphs, with the line breaks the model wrote', () => {
    expect(parseMarkdown('One line.\nThe next.\n\nA second paragraph.')).toEqual([
      para(text('One line.'), { kind: 'break' }, text('The next.')),
      para(text('A second paragraph.')),
    ]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n  ')).toEqual([]);
    expect(parseMarkdown('Windows\r\nline ends')).toEqual([
      para(text('Windows'), { kind: 'break' }, text('line ends')),
    ]);
  });

  it('bold, italics and inline code, nested the way they are written', () => {
    expect(parseMarkdown('**TrackIR** is *not* a step of `F/A-18C`.')).toEqual([
      para(
        { kind: 'strong', children: [text('TrackIR')] },
        text(' is '),
        { kind: 'em', children: [text('not')] },
        text(' a step of '),
        { kind: 'code', text: 'F/A-18C' },
        text('.')
      ),
    ]);
    expect(parseMarkdown('__bold__ and _italic_')).toEqual([
      para({ kind: 'strong', children: [text('bold')] }, text(' and '), {
        kind: 'em',
        children: [text('italic')],
      }),
    ]);
    expect(parseMarkdown('**bold with *italic* inside**')).toEqual([
      para({
        kind: 'strong',
        children: [text('bold with '), { kind: 'em', children: [text('italic')] }, text(' inside')],
      }),
    ]);
    expect(parseMarkdown('***both***')).toEqual([
      para({ kind: 'em', children: [{ kind: 'strong', children: [text('both')] }] }),
    ]);
  });

  it('leaves the names and sums of a technical answer alone', () => {
    // An underscore inside a word is part of the word; a star with spaces around is a star.
    for (const plain of [
      'Call setup_read, then manual_search and process_running.',
      '2 * 3 * 4 = 24',
      'A lone * star and a lone _ underscore',
      'C:\\Users\\{USER}\\Saved Games\\DCS',
      '5 < 6 > 4 & so on',
    ]) {
      expect(parseMarkdown(plain), plain).toEqual([para(text(plain))]);
    }
    expect(parseMarkdown('\\*not italic\\* and \\`not code\\`')).toEqual([
      para(text('*not italic* and `not code`')),
    ]);
    // In a Windows path a backslash is a separator, never an escape.
    for (const path of [
      'Saved Games\\DCS\\Config\\Input\\*.diff.lua and Saved Games\\DCS\\Scripts\\*.lua',
      'C:\\*.lua or C:\\Users\\_old\\[1]',
      '\\\\server\\share\\_x',
    ]) {
      expect(parseMarkdown(path), path).toEqual([para(text(path))]);
    }
    // A marker with nothing after it is what was written.
    expect(parseMarkdown('-')).toEqual([para(text('-'))]);
    expect(parseMarkdown('1.')).toEqual([para(text('1.'))]);
  });

  it('inline code keeps what is in it as it is', () => {
    expect(parseMarkdown('Use `**not bold**` and ``a ` tick``.')).toEqual([
      para(
        text('Use '),
        { kind: 'code', text: '**not bold**' },
        text(' and '),
        { kind: 'code', text: 'a ` tick' },
        text('.')
      ),
    ]);
    // A tick that never closes is a tick.
    expect(parseMarkdown('a ` lone tick')).toEqual([para(text('a ` lone tick'))]);
  });

  it('headings, rules and quotes', () => {
    expect(parseMarkdown('# One\n## Two ##\n###### Six\n####### seven\n#not a heading')).toEqual([
      { kind: 'heading', level: 1, children: [text('One')] },
      { kind: 'heading', level: 2, children: [text('Two')] },
      { kind: 'heading', level: 6, children: [text('Six')] },
      para(text('####### seven'), { kind: 'break' }, text('#not a heading')),
    ]);
    expect(parseMarkdown('above\n\n---\n\n* * *\nbelow')).toEqual([
      para(text('above')),
      { kind: 'rule' },
      { kind: 'rule' },
      para(text('below')),
    ]);
    expect(parseMarkdown('> quoted **text**\n> second line\n\nafter')).toEqual([
      {
        kind: 'quote',
        children: [
          para(
            text('quoted '),
            { kind: 'strong', children: [text('text')] },
            { kind: 'break' },
            text('second line')
          ),
        ],
      },
      para(text('after')),
    ]);
  });

  it('code blocks keep their text exactly, marks and all', () => {
    const source = [
      'Run this:',
      '```powershell',
      '# a comment, not a heading',
      'Start-Process -FilePath $exe  -WindowStyle Minimized',
      '',
      '<b>**not bold**</b>',
      '```',
      'Done.',
    ].join('\n');
    expect(parseMarkdown(source)).toEqual([
      para(text('Run this:')),
      {
        kind: 'code',
        language: 'powershell',
        text: '# a comment, not a heading\nStart-Process -FilePath $exe  -WindowStyle Minimized\n\n<b>**not bold**</b>',
      },
      para(text('Done.')),
    ]);
    // A fence left open (a reply cut off) runs to the end; ~~~ works the same.
    expect(parseMarkdown('```\nhalf a block')).toEqual([{ kind: 'code', text: 'half a block' }]);
    expect(parseMarkdown('~~~\n``` inside\n~~~')).toEqual([{ kind: 'code', text: '``` inside' }]);
    // The language is a plain word or nothing.
    expect(parseMarkdown('```<script>\nx\n```')).toEqual([{ kind: 'code', text: 'x' }]);
  });

  it('bullet and numbered lists, with lists inside them', () => {
    expect(parseMarkdown('- one\n- two **bold**\n* three')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          [para(text('one'))],
          [para(text('two '), { kind: 'strong', children: [text('bold')] })],
          [para(text('three'))],
        ],
      },
    ]);
    expect(parseMarkdown('3. third\n4. fourth\n\n5. fifth')).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [[para(text('third'))], [para(text('fourth'))], [para(text('fifth'))]],
      },
    ]);
    const nested = parseMarkdown(
      '1. Open Settings\n   - under AI\n   - choose a provider\n2. Store the key\n\n   It is kept by Windows.'
    );
    expect(nested).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 1,
        items: [
          [
            para(text('Open Settings')),
            {
              kind: 'list',
              ordered: false,
              start: 1,
              items: [[para(text('under AI'))], [para(text('choose a provider'))]],
            },
          ],
          [para(text('Store the key')), para(text('It is kept by Windows.'))],
        ],
      },
    ]);
    // A list ends where text without its indent follows a blank line.
    expect(parseMarkdown('- one\n\nafter')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[para(text('one'))]] },
      para(text('after')),
    ]);
    // A number in a sentence does not start a list in the middle of a paragraph.
    expect(parseMarkdown('The answer is\n42. Nothing else.')).toEqual([
      para(text('The answer is'), { kind: 'break' }, text('42. Nothing else.')),
    ]);
  });

  it('links to web addresses, written three ways', () => {
    expect(parseMarkdown('See [the manual](https://rigready.io/docs/setups/checks/).')).toEqual([
      para(
        text('See '),
        {
          kind: 'link',
          href: 'https://rigready.io/docs/setups/checks/',
          children: [text('the manual')],
        },
        text('.')
      ),
    ]);
    expect(
      parseMarkdown('It is at https://rigready.io/docs/ai/built-in-assistant/. Read it.')
    ).toEqual([
      para(
        text('It is at '),
        {
          kind: 'link',
          href: 'https://rigready.io/docs/ai/built-in-assistant/',
          children: [text('https://rigready.io/docs/ai/built-in-assistant/')],
        },
        text('. Read it.')
      ),
    ]);
    expect(links('<https://rigready.io/docs/> and (https://example.com/a_(b)) too')).toEqual([
      'https://rigready.io/docs/',
      'https://example.com/a_(b)',
    ]);
    expect(
      links('[with a title](https://rigready.io/ "RigReady") [http](http://example.com/x)')
    ).toEqual(['https://rigready.io/', 'http://example.com/x']);
    expect(parseMarkdown('[**bold** label](https://rigready.io/)')).toEqual([
      para({
        kind: 'link',
        href: 'https://rigready.io/',
        children: [{ kind: 'strong', children: [text('bold')] }, text(' label')],
      }),
    ]);
  });

  it('gives the plain text of a tree', () => {
    expect(
      plainText(parseMarkdown('# Title\n\n**Bold** and `code`\n\n- [a link](https://rigready.io/)'))
    ).toBe('TitleBold and codea link');
  });
});

describe('a reply that means harm', () => {
  it('HTML stays text: no node is ever made of a tag', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">click</a>',
      '<style>*{display:none}</style>',
      '<svg/onload=alert(1)>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    ];
    for (const source of hostile) {
      expect(parseMarkdown(source), source).toEqual([para(text(source))]);
    }
    // Inside every construct too.
    const wrapped = parseMarkdown(
      '# <script>a</script>\n- <img src=x>\n> <b>q</b>\n\n**<i>x</i>** `<u>c</u>`'
    );
    expect(plainText(wrapped)).toBe('<script>a</script><img src=x><b>q</b><i>x</i> <u>c</u>');
    // An address inside a tag is a link to that address, shown as written; the tag is text.
    const frame = '<iframe src="https://evil.example/x"></iframe>';
    expect(plainText(parseMarkdown(frame))).toBe(frame);
    expect(links(frame)).toEqual(['https://evil.example/x']);
    expect(links(hostile.join('\n\n'))).toEqual([]);
  });

  it('a link leads to a plain web address or it is no link', () => {
    for (const dest of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///C:/Windows/System32/cmd.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'rigready://docs/setups/checks',
      'ms-settings:privacy',
      'mailto:someone@example.com',
      '//evil.example/path',
      '/configure/settings',
      '#anchor',
      'evil.example',
      'https://',
      'https:///nohost',
      'https://user:password@evil.example/',
      'https://rigready.io@evil.example/',
      'https://evil.example\\@rigready.io/',
      'ftp://example.com/file',
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      expect(safeLink(dest), dest).toBeUndefined();
      expect(links(`[click here](${dest})`), dest).toEqual([]);
      expect(links(`<${dest}>`), dest).toEqual([]);
      expect(links(`![image](${dest})`), dest).toEqual([]);
    }
    // The words stay readable when the link is refused.
    expect(parseMarkdown('[click here](javascript:alert(1))')).toEqual([
      para(text('[click here](javascript:alert(1))')),
    ]);
    expect(safeLink('https://rigready.io/docs/')).toBe('https://rigready.io/docs/');
    expect(safeLink('HTTP://Example.COM/a b')).toBeUndefined();
    expect(safeLink('http://example.com/x')).toBe('http://example.com/x');
  });

  it('a link cannot show one address and lead to another', () => {
    const shown = (source: string): string => plainText(parseMarkdown(source));
    // A label that reads like an address must be the address.
    expect(shown('[https://rigready.io/docs](https://evil.example/login)')).toBe(
      'https://evil.example/login'
    );
    expect(shown('[rigready.io](https://evil.example/)')).toBe('https://evil.example/');
    expect(shown('[www.rigready.io/docs](https://evil.example/)')).toBe('https://evil.example/');
    expect(shown('[](https://evil.example/)')).toBe('https://evil.example/');
    // The same host under its own name is fine.
    expect(shown('[rigready.io](https://rigready.io/docs/)')).toBe('rigready.io');
    // Letters that only look like the ones they stand for: shown as it resolves.
    expect(shown('[the manual](https://r\u0456gready.io/docs/)')).toContain('xn--');
    expect(shown('Go to https://r\u0456gready.io/docs/ now')).toContain('xn--');
    // Marks that turn text around are taken out before anything is read.
    expect(shown('https://rigready.io/\u202Egpj.exe')).toBe('https://rigready.io/gpj.exe');
    expect(shown('safe\u202E txet')).toBe('safe txet');
  });

  it('an image is never a thing to load: it is a link to it, or text', () => {
    const tree = parseMarkdown('![a diagram](https://evil.example/pixel.png?who=you)');
    expect(tree).toEqual([
      para({
        kind: 'link',
        href: 'https://evil.example/pixel.png?who=you',
        children: [text('a diagram')],
      }),
    ]);
    const kinds = new Set(
      nodes(parseMarkdown('![x](https://a.example/b.png) ![y](data:x)')).map((n) => n.kind)
    );
    expect([...kinds].sort()).toEqual(['link', 'paragraph', 'text']);
  });

  it('what never closes is text, and nothing is lost', () => {
    for (const source of [
      '**bold that never ends',
      '*italic that never ends',
      '[a label with no address',
      '[a label](https://rigready.io/ no closing bracket',
      '[a label](',
      '](https://rigready.io/)',
      '`` two ticks and one `',
      '\\',
      '*',
      '_',
      '[',
      '![',
      '<',
      '<https://',
    ]) {
      expect(plainText(parseMarkdown(source)), source).toBe(source);
    }
  });

  it('control characters are taken out', () => {
    expect(plainText(parseMarkdown('a\u0000b\u0007c\u001Bd\u007Fe'))).toBe('abcde');
    expect(plainText(parseMarkdown('tab\there'))).toBe('tab    here');
  });

  it('stays quick and shallow on text built to be slow or deep', () => {
    const size = 30_000;
    const hard: [string, string][] = [
      ['unclosed italics', '*a '.repeat(size / 3)],
      ['unclosed bold', '**a '.repeat(size / 4)],
      ['stars only', '*'.repeat(size)],
      ['underscores only', '_'.repeat(size)],
      ['open brackets', '['.repeat(size)],
      ['brackets that close late', `${'['.repeat(size / 2)}${']'.repeat(size / 2)}`],
      ['labels without addresses', '[a]'.repeat(size / 3)],
      ['half links', '[a]('.repeat(size / 4)],
      ['ticks of every length', Array.from({ length: 240 }, (_, n) => '`'.repeat(n + 1)).join(' ')],
      ['single ticks', '` '.repeat(size / 2)],
      ['nested quotes', `${'>'.repeat(size)} deep`],
      [
        'nested bullets',
        Array.from({ length: 400 }, (_, n) => `${' '.repeat(n * 2)}- x`).join('\n'),
      ],
      ['nested emphasis', `${'*a '.repeat(400)}b${' a*'.repeat(400)}`],
      ['angle brackets', '<https://'.repeat(size / 9)],
      ['addresses', 'https://a.example/ '.repeat(size / 19)],
      ['backslashes', '\\'.repeat(size)],
      ['blank lines', '\n'.repeat(size)],
      ['one long line', 'a'.repeat(size)],
      ['hashes', '#'.repeat(size)],
      ['rule or list', '- '.repeat(size / 2)],
    ];
    for (const [name, source] of hard) {
      const began = performance.now();
      const tree = parseMarkdown(source);
      const took = performance.now() - began;
      expect(took, `${name} took ${Math.round(took)} ms`).toBeLessThan(1500);
      expect(depthOf(tree), name).toBeLessThanOrEqual(40);
    }
  });

  it('a reply longer than any real one is shown as plain text', () => {
    const long = `**bold** [link](https://rigready.io/)\n\n${'word '.repeat(MAX_MARKDOWN / 5)}`;
    const tree = parseMarkdown(long);
    expect(new Set(nodes(tree).map((n) => n.kind))).toEqual(new Set(['paragraph', 'text']));
    expect(plainText(tree)).toContain('**bold** [link](https://rigready.io/)');
  });

  it('whatever the text, the tree holds only known nodes and plain web links', () => {
    const KINDS = new Set([
      'text',
      'strong',
      'em',
      'code',
      'link',
      'break',
      'paragraph',
      'heading',
      'list',
      'quote',
      'rule',
    ]);
    const pieces = [
      '*',
      '**',
      '_',
      '__',
      '`',
      '```',
      '~~~',
      '[',
      ']',
      '(',
      ')',
      '<',
      '>',
      '!',
      '#',
      '-',
      '+',
      '1.',
      '>',
      '\\',
      '\n',
      '\n\n',
      ' ',
      '   ',
      'a',
      'word',
      'https://',
      'http://',
      'javascript:',
      'rigready.io',
      '/',
      '"',
      "'",
      '&',
      ';',
      'x_y',
      '<script>',
      '</script>',
      '\u202E',
      '\u0000',
    ];
    // A fixed sequence: the same texts on every run.
    let seed = 20261112;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 1500; round += 1) {
      let source = '';
      const length = (next() % 40) + 1;
      for (let i = 0; i < length; i += 1) source += pieces[next() % pieces.length];
      const all = nodes(parseMarkdown(source));
      for (const node of all) {
        expect(KINDS.has(node.kind), `${node.kind} from ${JSON.stringify(source)}`).toBe(true);
        if (node.kind === 'link') {
          expect(node.href, JSON.stringify(source)).toMatch(/^https?:\/\/[^\s\\@]+$/);
          expect(safeLink(node.href), JSON.stringify(source)).toBe(node.href);
        }
        if (node.kind === 'heading') expect(node.level).toBeGreaterThanOrEqual(1);
        if (node.kind === 'heading') expect(node.level).toBeLessThanOrEqual(6);
      }
    }
  });
});

function depthOf(tree: (Block | Inline)[]): number {
  let deepest = 0;
  const walk = (node: Block | Inline, depth: number): void => {
    deepest = Math.max(deepest, depth);
    if (node.kind === 'list') node.items.forEach((item) => item.forEach((n) => walk(n, depth + 1)));
    else if ('children' in node) node.children.forEach((n) => walk(n, depth + 1));
  };
  tree.forEach((node) => walk(node, 1));
  return deepest;
}
