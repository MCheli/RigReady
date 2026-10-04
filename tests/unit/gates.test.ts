/**
 * PLAT-016: the gates. `npm run ledger:check` fails on a "done" entry without evidence or
 * with evidence that does not exist; `npm run check` is typecheck, lint, format, unit
 * tests with a coverage threshold and the ledger check; and CI runs it on every push.
 * (The validator's own cases are in scripts/lib/lib.test.ts.)
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { validateLedger } from '../../scripts/lib/ledger';
import { repoRoot, tempDir } from '../helpers';

const ledgerFile = path.join(repoRoot, 'docs', 'requirements', 'ledger.yaml');

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** Runs the real command line of `npm run ledger:check` on a ledger file. */
function ledgerCheck(file: string): { status: number | null; output: string } {
  const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = spawnSync(process.execPath, [tsx, 'scripts/ledger-check.ts', file], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const entry = (fields: Record<string, unknown>): Record<string, unknown> => ({
  id: 'TEST-001',
  title: 'A requirement',
  job: 'platform',
  done_means: ['Something observable.'],
  status: 'todo',
  evidence: [],
  ...fields,
});

describe('PLAT-016 the ledger check', () => {
  it('the ledger in the repository is valid, and every done entry has a test that exists', () => {
    const report = validateLedger(ledgerFile, repoRoot);
    expect(report.found).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.total).toBeGreaterThan(200);
    expect(report.counts.done).toBeGreaterThan(150);
  });

  it('the command exits 0 on a valid ledger and 1, naming the entry, on each kind of broken one', async () => {
    const temp = await tempDir();
    cleanup = temp.cleanup;
    const write = async (name: string, requirements: unknown[]): Promise<string> => {
      const file = path.join(temp.dir, name);
      await fs.writeFile(file, yaml.dump({ requirements }));
      return file;
    };
    // Put together here so that the words are in no test file, this one included.
    const missingTitle = ['a', 'title', 'nobody', 'wrote'].join(' ');
    const realTest = 'tests/unit/gates.test.ts#the ledger in the repository is valid';

    const valid = await write('valid.yaml', [
      entry({}),
      entry({ id: 'TEST-002', status: 'done', evidence: [realTest] }),
    ]);
    const good = ledgerCheck(valid);
    expect(good.output).toContain('ledger: OK');
    expect(good.status).toBe(0);

    const cases: [string, Record<string, unknown>, RegExp][] = [
      [
        'done without evidence',
        { status: 'done' },
        /TEST-001: status is done but there is no evidence/,
      ],
      [
        'a test file that does not exist',
        { status: 'done', evidence: ['tests/unit/no-such.test.ts#anything'] },
        /TEST-001: evidence does not exist: tests\/unit\/no-such\.test\.ts/,
      ],
      [
        'a test title that is not in the file',
        { status: 'done', evidence: [`tests/unit/gates.test.ts#${missingTitle}`] },
        new RegExp(`TEST-001: test "${missingTitle}" not found`),
      ],
      [
        'a screenshot that does not exist',
        { status: 'done', evidence: [realTest, 'artifacts/screens/no-such-flow/01-x.png'] },
        /TEST-001: evidence does not exist: artifacts\/screens\/no-such-flow\/01-x\.png/,
      ],
      ['a status that is not one of the three', { status: 'finished' }, /TEST-001: status/],
      ['no acceptance criteria', { done_means: [] }, /TEST-001: done_means/],
    ];
    for (const [what, fields, message] of cases) {
      const file = await write('broken.yaml', [entry(fields)]);
      const result = ledgerCheck(file);
      expect(result.output, what).toMatch(message);
      expect(result.status, what).toBe(1);
    }
  }, 120_000);
});

describe('PLAT-016 npm run check, and CI', () => {
  it('check is typecheck, lint, format, unit tests with coverage and the ledger check, in that order', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check']!.split('&&').map((s) => s.trim())).toEqual([
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm run test:coverage',
      'npm run ledger:check',
    ]);
    // Both projects are type-checked for real, lint covers the whole tree.
    expect(pkg.scripts['typecheck']).toMatch(/tsc --noEmit -p tsconfig\.node\.json/);
    expect(pkg.scripts['typecheck']).toMatch(/vue-tsc --noEmit -p tsconfig\.web\.json/);
    expect(pkg.scripts['lint']).toBe('eslint .');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts['ledger:check']).toBe('tsx scripts/ledger-check.ts');
    // The coverage gate has thresholds, so "with coverage" can fail.
    const vitest = await fs.readFile(path.join(repoRoot, 'vitest.config.ts'), 'utf8');
    const thresholds = /thresholds:\s*\{([^}]*)\}/.exec(vitest)?.[1] ?? '';
    for (const measure of ['lines', 'functions', 'statements', 'branches']) {
      const value = Number(new RegExp(`${measure}:\\s*(\\d+)`).exec(thresholds)?.[1]);
      expect(value, measure).toBeGreaterThanOrEqual(70);
    }
  });

  it('CI runs npm run check on every push to every branch, and on pull requests', async () => {
    const text = await fs.readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const workflow = yaml.load(text) as {
      on: { push?: { branches?: string[] } | null; pull_request?: unknown };
      jobs: Record<string, { 'runs-on': string; needs?: string; steps: { run?: string }[] }>;
    };
    expect('push' in workflow.on).toBe(true);
    // No branch filter, or one that lets every branch through.
    const branches = workflow.on.push?.branches;
    expect(branches === undefined || branches.includes('**')).toBe(true);
    expect('pull_request' in workflow.on).toBe(true);
    const checking = Object.values(workflow.jobs).filter((job) =>
      job.steps.some((step) => step.run === 'npm run check')
    );
    expect(checking).toHaveLength(1);
    const job = checking[0]!;
    // Windows: the app, its native bindings and half of its tests are Windows-only.
    expect(job['runs-on']).toMatch(/^windows-/);
    // The gate waits for nothing and is skipped by nothing.
    expect(job.needs).toBeUndefined();
    expect(job.steps.map((s) => s.run).filter(Boolean)).toEqual(['npm ci', 'npm run check']);
  });
});
