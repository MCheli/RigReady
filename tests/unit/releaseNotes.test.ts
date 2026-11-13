import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot, tempDir } from '../helpers';

/**
 * scripts/release-notes.mjs: the release's description is the version's section of the
 * changelog, and a changelog that is not dated stops the release.
 */

const script = path.join(repoRoot, 'scripts', 'release-notes.mjs');

const changelog = `# Changelog

## 2.1.0 (not released)

Next.

## 2.0.0 (2026-11-14)

A rebuild from the ground up.

### What it contains

- One screen for the setup used last.

\`\`\`
## not a heading: a fenced example
\`\`\`

## 1.1.0 and earlier

The first version of the app.
`;

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await fs.writeFile(path.join(dir, 'CHANGELOG.md'), changelog);
});
afterEach(() => cleanup());

const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args, path.join(dir, 'CHANGELOG.md')], {
    encoding: 'utf8',
  });

describe('release notes from the changelog', () => {
  it('writes the dated section of the tagged version, with the tag written either way', async () => {
    const out = path.join(dir, 'notes', 'release-notes.md');
    const result = run('v2.0.0', out);
    expect(result.status, result.stderr).toBe(0);
    const notes = await fs.readFile(out, 'utf8');
    expect(notes).toBe(
      'A rebuild from the ground up.\n\n### What it contains\n\n- One screen for the setup used last.\n\n```\n## not a heading: a fenced example\n```\n'
    );
    expect(run('2.0.0', out).status).toBe(0);
  });

  it('keeps a section as written, its blank lines and bullets included, whatever the line ends', async () => {
    const lines = [
      '# Changelog',
      '',
      '## 2.0.0-beta.2 (2026-11-11)',
      '',
      'The first signed test build of 2.0.0.',
      '',
      'New since beta 1:',
      '',
      '- A code signature on the installer.',
      '- The Safety page names the assistant beside a change it made.',
      '',
      'What it contains is the [2.0.0 section of the changelog](https://example.invalid/CHANGELOG.md).',
      '',
      '## 2.0.0-beta.1 (2026-11-07)',
      '',
      'A test build of 2.0.0.',
      '',
    ];
    const out = path.join(dir, 'release-notes.md');
    for (const eol of ['\n', '\r\n']) {
      await fs.writeFile(path.join(dir, 'CHANGELOG.md'), lines.join(eol));
      const result = run('v2.0.0-beta.2', out);
      expect(result.status, result.stderr).toBe(0);
      expect(await fs.readFile(out, 'utf8')).toBe(
        'The first signed test build of 2.0.0.\n\nNew since beta 1:\n\n' +
          '- A code signature on the installer.\n' +
          '- The Safety page names the assistant beside a change it made.\n\n' +
          'What it contains is the [2.0.0 section of the changelog](https://example.invalid/CHANGELOG.md).\n'
      );
    }
  });

  it('refuses a version whose heading still says "(not released)", and one the changelog does not have', () => {
    const out = path.join(dir, 'release-notes.md');
    const undated = run('2.1.0', out);
    expect(undated.status).toBe(1);
    expect(undated.stderr).toContain('date the heading before tagging');
    const missing = run('2.0.1', out);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no "## 2.0.1" section');
    // "2.0" is not "2.0.0": a prefix never passes for a version.
    expect(run('2.0', out).status).toBe(1);
  });

  it('is what the Release workflow runs for its tag, before the tests', async () => {
    const workflow = await fs.readFile(
      path.join(repoRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    );
    expect(workflow).toContain(
      'node scripts/release-notes.mjs $env:TAG artifacts/release-notes.md'
    );
    // The tests are CI's workflow, run as a job of this one; the notes come before it.
    expect(workflow.indexOf('scripts/release-notes.mjs')).toBeLessThan(
      workflow.indexOf('uses: ./.github/workflows/ci.yml')
    );
  });
});
