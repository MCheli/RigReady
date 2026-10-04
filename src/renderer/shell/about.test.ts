import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aboutFacts, webLink, type PackageFacts } from './about';

describe('what the About panel says, from the package’s own description', () => {
  it('turns the addresses a package states into pages a person can open', () => {
    expect(webLink('https://rigready.io')).toBe('https://rigready.io');
    expect(webLink('https://rigready.io/')).toBe('https://rigready.io');
    // A repository as npm writes it.
    expect(webLink('git+https://github.com/example/rigready.git')).toBe(
      'https://github.com/example/rigready'
    );
    expect(webLink('  https://github.com/example/rigready/issues ')).toBe(
      'https://github.com/example/rigready/issues'
    );
  });

  it('offers nothing that is not an https address: only those are handed to the browser', () => {
    expect(webLink('http://example.com')).toBeUndefined();
    expect(webLink('file:///C:/Windows/win.ini')).toBeUndefined();
    expect(webLink('javascript:alert(1)')).toBeUndefined();
    expect(webLink('github:example/rigready')).toBeUndefined();
    expect(webLink('not an address')).toBeUndefined();
    expect(webLink('')).toBeUndefined();
    expect(webLink(undefined)).toBeUndefined();
  });

  it('lists the website, the source and where to report a problem, each shown without its scheme', () => {
    const facts = aboutFacts({
      license: 'MIT',
      homepage: 'https://www.example.org',
      author: { name: 'A. Pilot', url: 'https://example.org/pilot' },
      repository: { url: 'git+https://github.com/example/rig.git' },
      bugs: { url: 'https://github.com/example/rig/issues' },
      build: { copyright: 'Copyright (c) 2026 A. Pilot' },
    });
    expect(facts.licence).toBe('MIT');
    expect(facts.copyright).toBe('Copyright (c) 2026 A. Pilot');
    expect(facts.links).toEqual([
      { id: 'website', label: 'Website', url: 'https://www.example.org', shown: 'example.org' },
      {
        id: 'source',
        label: 'Source code',
        url: 'https://github.com/example/rig',
        shown: 'github.com/example/rig',
      },
      {
        id: 'issues',
        label: 'Report a problem',
        url: 'https://github.com/example/rig/issues',
        shown: 'github.com/example/rig/issues',
      },
    ]);
  });

  it('says only what the package states: no licence, no author, no address, then nothing', () => {
    expect(aboutFacts({})).toEqual({ links: [] });
    // The plain-text forms npm also allows.
    const plain = aboutFacts({
      author: 'A. Pilot',
      repository: 'https://github.com/example/rig',
      bugs: 'mailto:someone@example.org',
    });
    expect(plain.copyright).toBe('Copyright A. Pilot');
    expect(plain.links.map((l) => l.id)).toEqual(['source']);
  });

  it('the package this app is built from states a licence, a website, its source and where to report a problem', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')
    ) as PackageFacts;
    const facts = aboutFacts(pkg);
    expect(facts.licence).toBe('MIT');
    expect(facts.copyright).toMatch(/^Copyright \(c\) \d{4} /);
    expect(facts.links.map((l) => l.id)).toEqual(['website', 'source', 'issues']);
    for (const link of facts.links) expect(link.url).toMatch(/^https:\/\//);
  });
});
