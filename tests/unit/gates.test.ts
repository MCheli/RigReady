/**
 * PLAT-016: the gates. `npm run ledger:check` fails on a "done" entry without evidence or
 * with evidence that does not exist; `npm run check` is typecheck, lint, format, unit
 * tests with a coverage threshold and the ledger check; and CI runs every part of it on
 * every push to main and on every pull request.
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

  it('CI runs every part of npm run check on every push to main, and on pull requests into main', async () => {
    interface Step {
      name?: string;
      run?: string;
      uses?: string;
      if?: string;
      env?: Record<string, string>;
      with?: Record<string, unknown>;
    }
    interface Job {
      name?: string;
      'runs-on': string;
      needs?: string | string[];
      if?: string;
      strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown[]> };
      steps: Step[];
    }
    const text = await fs.readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const workflow = yaml.load(text) as {
      on: { push?: { branches?: string[] } | null; pull_request?: { branches?: string[] } | null };
      jobs: Record<string, Job>;
    };
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // A branch is checked by its pull request; main is checked on every push.
    expect(workflow.on.push?.branches).toEqual(['main']);
    expect(workflow.on.pull_request?.branches).toEqual(['main']);

    const jobs = Object.entries(workflow.jobs);
    const needs = (job: Job): string[] =>
      job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
    const commands = (job: Job): string[] =>
      job.steps
        .filter((step) => step.name !== 'Prepare the runner')
        .flatMap((step) => (step.run ? [step.run] : []));
    const running = (start: string): [string, Job][] =>
      jobs.filter(([, job]) => job.steps.some((step) => step.run?.startsWith(start)));

    // No job runs the whole command: on one runner its unit tests alone took eight to thirteen
    // minutes, the longest job of every run. CI runs the command's parts, and all of them.
    const parts = pkg.scripts['check']!.split('&&').map((s) => s.trim());
    const rest = parts.filter((part) => part !== 'npm run test:coverage');
    expect(rest).toHaveLength(parts.length - 1);

    // Everything but the unit tests: one job, in the command's order. Windows: the app, its
    // native bindings and half of its tests are Windows-only. It waits for nothing and is
    // skipped by nothing.
    const statics = running(rest[0]!);
    expect(statics).toHaveLength(1);
    const [staticId, still] = statics[0]!;
    expect(still['runs-on']).toMatch(/^windows-/);
    expect(still.needs).toBeUndefined();
    expect(still.if).toBeUndefined();
    expect(commands(still)).toEqual(['npm ci', ...rest]);

    // The unit tests: `npm run test:coverage` itself, with a report for the merge and without
    // the limits (a part of the tests reaches a part of the code: one shard of four alone had
    // 54 to 76% of the lines), on one Windows runner per shard. Besides preparing the runner
    // (its virus scanner has timed the unit tests out), a shard is nothing but npm ci and
    // that command, and one failing shard does not stop the others.
    const measures = ['lines', 'functions', 'statements', 'branches'];
    expect(pkg.scripts['test:coverage:shard']).toBe(
      [
        pkg.scripts['test:coverage'],
        '--reporter=default',
        '--reporter=blob',
        ...measures.map((measure) => `--coverage.thresholds.${measure}=0`),
      ].join(' ')
    );
    const shards = running('npm run test:coverage:shard');
    expect(shards).toHaveLength(1);
    const [unitId, unit] = shards[0]!;
    const numbers = unit.strategy?.matrix?.['shard'] ?? [];
    const total = numbers.length;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(numbers).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(unit.strategy?.['fail-fast']).toBe(false);
    expect(unit.name).toContain('${{ matrix.shard }}');
    expect(unit['runs-on']).toMatch(/^windows-/);
    expect(unit.needs).toBeUndefined();
    expect(unit.if).toBeUndefined();
    expect(commands(unit)).toEqual([
      'npm ci',
      `npm run test:coverage:shard -- --shard=\${{ matrix.shard }}/${total}`,
    ]);
    // Each shard hands its report on, and a shard that wrote none fails.
    const keep = unit.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))!;
    expect(keep.if).toBeUndefined();
    expect(keep.with).toMatchObject({
      name: 'unit-report-shard-${{ matrix.shard }}',
      path: '.vitest/blob/',
      'include-hidden-files': true,
      'if-no-files-found': 'error',
    });

    // The coverage limits are those of vitest.config.ts (the test above), applied once, to all
    // the shards' reports together: tried on a desk PC, the merged figures were those of one
    // run (93.57% of statements against 93.55%), and a limit that cannot be met failed the
    // merge. The job runs only when every shard passed. Vitest merges whatever reports it
    // finds, and three of four still cleared the limits (83.9%), so they are counted first.
    expect(pkg.scripts['test:coverage:merge']).toBe('vitest --merge-reports --coverage');
    const merging = running('npm run test:coverage:merge');
    expect(merging).toHaveLength(1);
    const [coverageId, coverage] = merging[0]!;
    expect(coverage['runs-on']).toMatch(/^windows-/);
    expect(needs(coverage)).toEqual([unitId]);
    expect(coverage.if).toBeUndefined();
    for (const step of coverage.steps) expect(step.if).toBeUndefined();
    const fetchAt = coverage.steps.findIndex((step) =>
      step.uses?.startsWith('actions/download-artifact@')
    );
    const countAt = coverage.steps.findIndex((step) => step.run?.includes(`-ne ${total}`));
    const mergeAt = coverage.steps.findIndex((step) => step.run === 'npm run test:coverage:merge');
    expect(fetchAt).toBeGreaterThanOrEqual(0);
    expect(countAt).toBeGreaterThan(fetchAt);
    expect(mergeAt).toBeGreaterThan(countAt);
    expect(coverage.steps[fetchAt]!.with).toMatchObject({
      pattern: 'unit-report-shard-*',
      path: '.vitest/blob',
      'merge-multiple': true,
    });
    expect(coverage.steps[countAt]!.run).toContain(`'blob-*-${total}.json'`);
    expect(coverage.steps[countAt]!.run).toContain('exit 1');

    // One check carries the name the branch ruleset requires. It reports whatever became of
    // the parts, and each one's result must be success: a coverage job that was skipped
    // because a shard failed is a failure, and a cancelled part is not a check that never came.
    const sums = jobs.filter(
      ([, job]) => job.name === 'Check (typecheck, lint, format, unit tests, ledger)'
    );
    expect(sums).toHaveLength(1);
    const sum = sums[0]![1];
    expect([...needs(sum)].sort()).toEqual([staticId, unitId, coverageId].sort());
    expect(sum.if).toBe('always()');
    expect(sum.steps).toHaveLength(1);
    const verdict = sum.steps[0]!;
    const tests = needs(sum).map((id) => {
      const variable = Object.entries(verdict.env ?? {}).find(
        ([, value]) => value === `\${{ needs.${id}.result }}`
      )?.[0];
      expect(variable, id).toBeDefined();
      return `test "$${variable}" = success`;
    });
    // The step's last line is all of them and nothing else, so its exit code is theirs.
    expect(verdict.run!.trim().split('\n').pop()).toBe(tests.join(' && '));
  });
});
