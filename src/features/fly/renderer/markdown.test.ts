import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('instructions Markdown', () => {
  it('turns paragraphs, lists, bold, code and links into plain data', () => {
    expect(
      parseMarkdown(
        'Open **HidHide Configuration Client**.\n\n1. Go to `Devices`\n2. Untick the pedals\n   and press Save\n- See [the guide](https://github.com/nefarius/HidHide)'
      )
    ).toEqual([
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'Open ' },
          { kind: 'bold', text: 'HidHide Configuration Client' },
          { kind: 'text', text: '.' },
        ],
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          [
            { kind: 'text', text: 'Go to ' },
            { kind: 'code', text: 'Devices' },
          ],
          [{ kind: 'text', text: 'Untick the pedals and press Save' }],
        ],
      },
      {
        kind: 'list',
        ordered: false,
        items: [
          [
            { kind: 'text', text: 'See ' },
            { kind: 'link', text: 'the guide', url: 'https://github.com/nefarius/HidHide' },
          ],
        ],
      },
    ]);
  });

  it('never makes HTML or non-web links live: they stay text', () => {
    const html = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).toEqual([
      {
        kind: 'paragraph',
        content: [{ kind: 'text', text: '<script>alert(1)</script> <img src=x onerror=alert(1)>' }],
      },
    ]);
    expect(parseInline('[run](file:///C:/Windows/System32/cmd.exe)')).toEqual([
      { kind: 'text', text: 'run (file:///C:/Windows/System32/cmd.exe)' },
    ]);
    expect(parseInline('[x](javascript:alert(1))')[0]!.kind).toBe('text');
    expect(parseMarkdown('a\nb\n- c\nd')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'a b' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'c' }]] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'd' }] },
    ]);
  });
});
