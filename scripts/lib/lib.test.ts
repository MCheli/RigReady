import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../tests/helpers';
import { validateLedger } from './ledger';
import { sanitizeDeep, sanitizeUserPaths } from './sanitize';

describe('sanitizeUserPaths', () => {
  it('replaces only the user name segment of paths', () => {
    expect(sanitizeUserPaths('C:\\Users\\Owner\\Saved Games\\DCS', 'Owner')).toBe(
      'C:\\Users\\User\\Saved Games\\DCS'
    );
    expect(sanitizeUserPaths('"C:\\\\Users\\\\owner\\\\x"', 'Owner')).toBe(
      '"C:\\\\Users\\\\User\\\\x"'
    );
    expect(sanitizeUserPaths('C:/Users/Owner/x and C:/Users/Owner', 'Owner')).toBe(
      'C:/Users/User/x and C:/Users/User'
    );
    expect(sanitizeUserPaths('The Owner of C:\\Users\\Ownership\\x', 'Owner')).toBe(
      'The Owner of C:\\Users\\Ownership\\x'
    );
    expect(sanitizeUserPaths('C:\\Users\\A.B+C\\x', 'A.B+C')).toBe('C:\\Users\\User\\x');
    expect(sanitizeUserPaths('unchanged', '')).toBe('unchanged');
  });

  it('walks nested values', () => {
    expect(
      sanitizeDeep({ a: ['C:\\Users\\Owner\\x', 5, null], b: { c: 'C:\\Users\\Owner' } }, 'Owner')
    ).toEqual({
      a: ['C:\\Users\\User\\x', 5, null],
      b: { c: 'C:\\Users\\User' },
    });
  });
});

describe('validateLedger', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let file: string;
  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir());
    file = path.join(dir, 'ledger.yaml');
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'artifacts', 'screens', 'fly'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tests', 'a.test.ts'),
      "it('opens on the last profile', () => {})"
    );
    await fs.writeFile(path.join(dir, 'artifacts', 'screens', 'fly', 'ready.png'), '');
  });
  afterEach(() => cleanup());

  const entry = (extra: string): string => `
requirements:
  - id: FLY-001
    title: Open on the last-used profile
    job: fly
    area: fly
    done_means: ["shows the last profile"]
${extra}`;

  it('tolerates an absent file', () => {
    expect(validateLedger(file, dir)).toEqual({
      found: false,
      total: 0,
      counts: { todo: 0, in_progress: 0, done: 0 },
      problems: [],
    });
  });

  it('accepts todo entries without evidence and extra fields', async () => {
    await fs.writeFile(file, entry('    status: todo\n    evidence: []'));
    expect(validateLedger(file, dir)).toMatchObject({
      found: true,
      total: 1,
      counts: { todo: 1 },
      problems: [],
    });
  });

  it('accepts done with an existing test and screenshot, in every reference style', async () => {
    await fs.writeFile(
      file,
      entry(`    status: done
    evidence:
      - tests/a.test.ts#opens on the last profile
      - "tests/a.test.ts > opens on the last profile"
      - tests/a.test.ts::opens on the last profile
      - tests/a.test.ts
      - artifacts/screens/fly/ready.png
      - { test: "tests/a.test.ts#opens on the last profile" }
      - { screenshot: artifacts/screens/fly/ready.png }
      - { path: artifacts/screens/fly/ready.png }`)
    );
    expect(validateLedger(file, dir)).toMatchObject({ counts: { done: 1 }, problems: [] });
  });

  it('fails done without evidence, with missing evidence, or with screenshots only', async () => {
    await fs.writeFile(file, entry('    status: done'));
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: status is done but there is no evidence',
    ]);
    await fs.writeFile(
      file,
      entry(`    status: done
    evidence:
      - tests/missing.test.ts#x
      - tests/a.test.ts#a test that was renamed
      - artifacts/screens/fly/nope.png
      - ../outside.png`)
    );
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: evidence does not exist: tests/missing.test.ts',
      'FLY-001: test "a test that was renamed" not found in tests/a.test.ts',
      'FLY-001: evidence does not exist: artifacts/screens/fly/nope.png',
      'FLY-001: evidence points outside the repository: ../outside.png',
    ]);
    await fs.writeFile(
      file,
      entry('    status: done\n    evidence: [artifacts/screens/fly/ready.png]')
    );
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: done needs at least one automated test as evidence',
    ]);
  });

  it('reports schema problems, duplicates and broken files', async () => {
    await fs.writeFile(
      file,
      `- { id: FLY-001, title: A, job: fly, done_means: [x], status: todo }
- { id: FLY-001, title: B, job: fly, done_means: [x], status: in_progress }
- { id: bad id, title: C, job: flying, done_means: [], status: finished }
- just a string`
    );
    const report = validateLedger(file, dir);
    expect(report.total).toBe(2);
    expect(report.problems).toContain('FLY-001: duplicate id');
    expect(report.problems.some((p) => p.startsWith('bad id: job:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('bad id: status:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('bad id: done_means:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('entry 4:'))).toBe(true);

    await fs.writeFile(file, 'requirements: [unclosed');
    expect(validateLedger(file, dir).problems[0]).toMatch(/not valid YAML/);
    await fs.writeFile(file, 'something: else');
    expect(validateLedger(file, dir).problems).toEqual([
      'the file must contain a "requirements" list',
    ]);
  });
});
