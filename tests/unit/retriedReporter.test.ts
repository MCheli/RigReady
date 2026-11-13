import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import RetriedReporter, {
  errorLines,
  retriedSummary,
  secondLook,
  type Attempted,
} from '../e2e/retriedReporter';
import { repoRoot, tempDir } from '../helpers';

/**
 * CI runs a failed scenario test a second time. A pass at the second attempt leaves the job
 * green, so the job summary has to say which tests needed it.
 */

const RED = `${String.fromCharCode(27)}[31m`;
const RESET = `${String.fromCharCode(27)}[39m`;

const toContainText = [
  `Error: ${RED}expect(${RESET}locator${RED}).toContainText(${RESET}expected${RED})${RESET} failed`,
  '',
  "Locator: getByTestId('screens-monitor-CENTER_MFCD')",
  'Expected substring: "LC49G95T"',
  'Received string:    "USB_Monitor (3 of 3)"',
  'Timeout: 30000ms',
  '',
  'Call log:',
  '  - Expect "toContainText" with timeout 30000ms',
  '    at C:\\repo\\tests\\e2e\\dcs-setup.e2e.ts:177:65',
].join('\n');

const attempted = (
  line: number,
  title: string,
  outcome: ReturnType<Attempted['outcome']>,
  results: { status: Attempted['results'][number]['status']; message?: string }[]
): Attempted => ({
  title,
  location: { file: path.join(repoRoot, 'tests', 'e2e', 'dcs-setup.e2e.ts'), line, column: 1 },
  outcome: () => outcome,
  results: results.map((result) => ({
    status: result.status,
    ...(result.message === undefined ? {} : { error: { message: result.message } }),
  })),
});

const flaky = attempted(81, 'dcs-setup: screens are imported', 'flaky', [
  { status: 'failed', message: toContainText },
  { status: 'passed' },
]);
const broken = attempted(204, 'dcs-setup: a <second> `test`', 'unexpected', [
  { status: 'timedOut', message: 'Test timeout of 180000ms exceeded.' },
  { status: 'failed', message: 'Error: something else at the second attempt' },
]);
const fine = attempted(300, 'dcs-setup: a third test', 'expected', [{ status: 'passed' }]);
const skipped = attempted(400, 'dcs-setup: a fourth test', 'skipped', [{ status: 'skipped' }]);

describe('the tests that needed a second attempt, in the job summary', () => {
  it('keeps the lines of an error that say what was expected and what was there', () => {
    expect(errorLines(toContainText)).toEqual([
      'Error: expect(locator).toContainText(expected) failed',
      "Locator: getByTestId('screens-monitor-CENTER_MFCD')",
      'Expected substring: "LC49G95T"',
      'Received string:    "USB_Monitor (3 of 3)"',
      'Timeout: 30000ms',
    ]);
    expect(errorLines(undefined)).toEqual(['(the attempt left no error text)']);
    // A long error is cut, by line and by length.
    const long = errorLines(
      Array.from({ length: 20 }, (_, i) => `${i} ${'x'.repeat(400)}`).join('\n')
    );
    expect(long).toHaveLength(6);
    expect(long[0]).toHaveLength(203);
  });

  it('lists a test that failed and then passed, with the error of the attempt that failed', () => {
    expect(secondLook(flaky, repoRoot)).toEqual({
      where: 'tests/e2e/dcs-setup.e2e.ts:81',
      title: 'dcs-setup: screens are imported',
      error: errorLines(toContainText),
      passed: true,
    });
  });

  it('lists a test that failed at every attempt as failed, and no test that passed first time', () => {
    expect(secondLook(broken, repoRoot)).toEqual({
      where: 'tests/e2e/dcs-setup.e2e.ts:204',
      title: 'dcs-setup: a <second> `test`',
      error: ['Test timeout of 180000ms exceeded.'],
      passed: false,
    });
    expect(secondLook(fine, repoRoot)).toBeUndefined();
    expect(secondLook(skipped, repoRoot)).toBeUndefined();
  });

  it('says so in one line when every test passed at its first attempt', () => {
    expect(retriedSummary([])).toBe('**Scenario tests:** every one passed at its first attempt.\n');
  });

  it('writes the retried tests under a heading of their own that says they did not fail the job', () => {
    const text = retriedSummary([secondLook(flaky, repoRoot)!, secondLook(broken, repoRoot)!]);
    const [retried, failed] = text.split('### 1 scenario test failed');
    expect(retried).toContain('### 1 scenario test passed only at a second attempt');
    expect(retried).toContain('None of these fails the job: each failed first and passed');
    expect(retried).toContain('- `tests/e2e/dcs-setup.e2e.ts:81` dcs-setup: screens are imported');
    expect(retried).toContain('  Received string:    "USB_Monitor (3 of 3)"');
    expect(retried).not.toContain('dcs-setup.e2e.ts:204');
    // The failed test is under its own heading, and its title cannot break the page.
    expect(failed).toContain("- `tests/e2e/dcs-setup.e2e.ts:204` dcs-setup: a &lt;second> 'test'");
    expect(failed).toContain('  Test timeout of 180000ms exceeded.');
    expect(text).not.toContain('every one passed');

    const two = retriedSummary([secondLook(flaky, repoRoot)!, secondLook(flaky, repoRoot)!]);
    expect(two).toContain('### 2 scenario tests passed only at a second attempt');
    expect(two).not.toContain('failed\n\nEach of these failed at every attempt');
  });

  it('adds the summary to the file GitHub names, after what is there, and nowhere on a desk PC', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const summaryFile = path.join(dir, 'summary.md');
      await fs.writeFile(summaryFile, 'from an earlier step\n');
      const suite = { allTests: () => [fine, flaky, skipped] };

      const reporter = new RetriedReporter({ summaryFile });
      reporter.onBegin(undefined, suite);
      reporter.onEnd();
      const written = await fs.readFile(summaryFile, 'utf8');
      expect(written.startsWith('from an earlier step\n\n### 1 scenario test passed only')).toBe(
        true
      );
      expect(written).toContain('tests/e2e/dcs-setup.e2e.ts:81');

      const allGreen = new RetriedReporter({ summaryFile });
      allGreen.onBegin(undefined, { allTests: () => [fine, skipped] });
      allGreen.onEnd();
      expect((await fs.readFile(summaryFile, 'utf8')).endsWith('at its first attempt.\n')).toBe(
        true
      );

      // No file named: nothing is written anywhere.
      const before = process.env['GITHUB_STEP_SUMMARY'];
      delete process.env['GITHUB_STEP_SUMMARY'];
      try {
        const quiet = new RetriedReporter();
        quiet.onBegin(undefined, suite);
        expect(() => quiet.onEnd()).not.toThrow();
        expect(await fs.readdir(dir)).toEqual(['summary.md']);
      } finally {
        if (before !== undefined) process.env['GITHUB_STEP_SUMMARY'] = before;
      }
    } finally {
      await cleanup();
    }
  });

  it('is one of the reporters of the scenario tests, which are run again once on CI', async () => {
    const config = await fs.readFile(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("['./tests/e2e/retriedReporter.ts']");
    expect(config).toContain('retries: slow ? 1 : 0');
  });
});
