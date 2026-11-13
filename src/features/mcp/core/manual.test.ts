import { describe, expect, it } from 'vitest';
import {
  bundledManual,
  readManualPage,
  searchManual,
  sectionOf,
  sectionsOf,
  type ManualPage,
} from './manual';

/**
 * One section of a manual page instead of the whole page: what an assistant reads, it pays
 * for again with every later request, and a long page answers most questions in one section.
 */

const BODY = [
  'What a setup can check.',
  '',
  '## Apps and services',
  '',
  'Programs that must run.',
  '',
  '### App running (`process.running`)',
  '',
  'Passes when a program with this file name runs.',
  '',
  '```powershell',
  '# Not a heading: a comment in a script',
  'Get-Process TrackIR5',
  '```',
  '',
  '### Windows service running (`service.running`)',
  '',
  'Passes when the service runs.',
  '',
  '## Monitors',
  '',
  'The monitor layout a setup expects.',
].join('\n');

const page = (path: string, title: string, body: string): ManualPage => ({
  path,
  section: path.split('/')[0] ?? '',
  page: path.split('/')[1] ?? '',
  title,
  description: `About ${title}.`,
  order: 1,
  body,
  uri: `rigready://docs/${path}`,
});

const pages = [
  page('setups/checks', 'What a setup can check', BODY),
  page('setups/plain', 'A page without headings', 'One paragraph about TrackIR5 and nothing else.'),
];

describe('ASSIST-006 one section of a manual page', () => {
  it('lists the headings of a page, and a # inside a code fence is not one', () => {
    expect(sectionsOf(BODY)).toEqual([
      'Apps and services',
      'App running (`process.running`)',
      'Windows service running (`service.running`)',
      'Monitors',
    ]);
  });

  it('reads a section up to the next heading of its level or above', () => {
    const app = sectionOf(BODY, 'App running (`process.running`)');
    expect(app).toMatch(/^### App running/);
    expect(app).toContain('Get-Process TrackIR5');
    expect(app).not.toContain('Windows service');
    // A section holds the sections under it.
    const apps = sectionOf(BODY, 'Apps and services');
    expect(apps).toContain('### App running');
    expect(apps).toContain('### Windows service running');
    expect(apps).not.toContain('## Monitors');
    // The last section runs to the end of the page.
    expect(sectionOf(BODY, 'Monitors')).toBe('## Monitors\n\nThe monitor layout a setup expects.');
  });

  it('finds a section by a part of its heading and whatever its punctuation, the exact one first', () => {
    expect(sectionOf(BODY, 'app running')).toMatch(/^### App running/);
    expect(sectionOf(BODY, 'process.running')).toMatch(/^### App running/);
    expect(sectionOf(BODY, 'windows service')).toMatch(/^### Windows service running/);
    expect(sectionOf(BODY, 'monitors')).toMatch(/^## Monitors/);
    expect(sectionOf(BODY, 'no such heading')).toBeUndefined();
    expect(sectionOf(BODY, '   ')).toBeUndefined();
    expect(sectionOf(BODY, '###')).toBeUndefined();
  });

  it('a search names the sections its lines stand under', () => {
    const hits = searchManual(pages, 'service runs');
    expect(hits).toHaveLength(1);
    // A line is taken when it holds any word of the query: one section per line taken, once.
    expect(hits[0]).toMatchObject({
      title: 'What a setup can check',
      sections: [
        'Apps and services',
        'App running (`process.running`)',
        'Windows service running (`service.running`)',
      ],
    });
    // A page without headings has lines and no sections.
    const plain = searchManual(pages, 'TrackIR5 nothing');
    expect(plain).toHaveLength(1);
    expect(plain[0]?.lines).toEqual(['One paragraph about TrackIR5 and nothing else.']);
    expect(plain[0]?.sections).toBeUndefined();
  });

  it('reads the whole page without a section, and only the section under the title with one', () => {
    const whole = readManualPage(pages, 'setups/checks');
    expect(whole.ok && whole.text).toBe(
      `# What a setup can check\n\nAbout What a setup can check.\n\n${BODY}`
    );
    expect(readManualPage(pages, 'setups/checks', '  ')).toEqual(whole);

    const part = readManualPage(pages, 'rigready://docs/setups/checks', 'Windows service');
    expect(part.ok && part.text).toBe(
      '# What a setup can check\n\n### Windows service running (`service.running`)\n\nPasses when the service runs.'
    );
  });

  it('a section the page does not have is refused with the sections it has', () => {
    const missing = readManualPage(pages, 'setups/checks', 'Audio');
    expect(missing).toEqual({
      ok: false,
      message:
        'The manual page What a setup can check has no section "Audio". Its sections: Apps and services; App running (`process.running`); Windows service running (`service.running`); Monitors.',
    });
    const none = readManualPage(pages, 'setups/plain', 'Audio');
    expect(none.ok).toBe(false);
    expect(!none.ok && none.message).toContain('It has no sections: read the whole page.');
  });

  it('on the manual the app ships, one section is a fraction of its page', () => {
    const manual = bundledManual();
    const whole = readManualPage(manual, 'setups/checks');
    const part = readManualPage(manual, 'setups/checks', 'App running');
    expect(whole.ok && part.ok).toBe(true);
    if (!whole.ok || !part.ok) return;
    expect(part.text).toContain('process.running');
    expect(part.text.length).toBeLessThan(whole.text.length / 5);
    // Every section a search names can be read.
    for (const hit of searchManual(manual, 'TrackIR')) {
      for (const section of hit.sections ?? []) {
        expect(readManualPage(manual, hit.uri, section).ok, `${hit.uri} > ${section}`).toBe(true);
      }
    }
  });
});
