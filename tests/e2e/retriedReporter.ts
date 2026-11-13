import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Says in the job summary on GitHub which scenario tests failed first and passed when run
 * again. CI runs a failed scenario test a second time (playwright.config.ts), and a pass at
 * the second attempt leaves the job green: without this the only trace is one line far down
 * the log, and a fault that comes and goes is never looked at.
 *
 * Writes only where GitHub says the summary goes (GITHUB_STEP_SUMMARY), so on a desk PC it
 * does nothing.
 */

/** What the summary needs of a test: a Playwright test has it, and so has a plain object. */
export type Attempted = Pick<TestCase, 'title' | 'location' | 'outcome'> & {
  results: Pick<TestResult, 'status' | 'error'>[];
};

/** A test that did not pass at its first attempt. */
export interface SecondLook {
  /** The file from the repository root and the line of the test: tests/e2e/x.e2e.ts:12. */
  where: string;
  title: string;
  /** How the first failed attempt failed: the first lines of its error. */
  error: string[];
  /** True when a later attempt passed, so the job stayed green. */
  passed: boolean;
}

const ERROR_LINES = 6;
const LINE_LENGTH = 200;

/** The lines of an error that say what was expected and what was there, without colours. */
export function errorLines(message: string | undefined): string[] {
  const lines: string[] = [];
  for (const raw of stripVTControlCharacters(message ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // What follows is the list of calls and the stack: the log has them.
    if (/^(Call log:|at )/.test(line)) break;
    lines.push(line.length > LINE_LENGTH ? `${line.slice(0, LINE_LENGTH)}...` : line);
    if (lines.length === ERROR_LINES) break;
  }
  return lines.length > 0 ? lines : ['(the attempt left no error text)'];
}

/** The entry for a test that failed at least once; nothing for one that passed first time. */
export function secondLook(test: Attempted, root: string): SecondLook | undefined {
  const outcome = test.outcome();
  if (outcome !== 'flaky' && outcome !== 'unexpected') return undefined;
  const failed = test.results.find(
    (result) => result.status !== 'passed' && result.status !== 'skipped'
  );
  return {
    where: `${path.relative(root, test.location.file).replace(/\\/g, '/')}:${test.location.line}`,
    title: test.title,
    error: errorLines(failed?.error?.message),
    passed: outcome === 'flaky',
  };
}

const count = (n: number): string => (n === 1 ? '1 scenario test' : `${n} scenario tests`);

const plain = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/`/g, "'");

const item = (test: SecondLook): string[] => [
  `- \`${test.where}\` ${plain(test.title)}`,
  '',
  '  ```',
  ...test.error.map((line) => `  ${line.replace(/```/g, "'''")}`),
  '  ```',
  '',
];

/** The text for the job summary (Markdown), from every test that failed at least once. */
export function retriedSummary(tests: readonly SecondLook[]): string {
  const retried = tests.filter((test) => test.passed);
  const failed = tests.filter((test) => !test.passed);
  const lines: string[] = [];
  if (retried.length === 0 && failed.length === 0) {
    lines.push('**Scenario tests:** every one passed at its first attempt.', '');
  }
  if (retried.length > 0) {
    lines.push(
      `### ${count(retried.length)} passed only at a second attempt`,
      '',
      'None of these fails the job: each failed first and passed when run again. A fault that comes and goes is still there, in the test or in the app.',
      '',
      ...retried.flatMap(item)
    );
  }
  if (failed.length > 0) {
    lines.push(
      `### ${count(failed.length)} failed`,
      '',
      'Each of these failed at every attempt. The error is the one of the first attempt.',
      '',
      ...failed.flatMap(item)
    );
  }
  return lines.join('\n');
}

export interface RetriedReporterOptions {
  /** Where the summary is added. Default: the file GitHub names in GITHUB_STEP_SUMMARY. */
  summaryFile?: string;
}

/** This file is tests/e2e/retriedReporter.ts: the repository root is two folders up. */
const repoRoot = path.resolve(__dirname, '..', '..');

export default class RetriedReporter implements Reporter {
  private readonly summaryFile: string | undefined;
  private suite: { allTests(): Attempted[] } | undefined;

  constructor(options: RetriedReporterOptions = {}) {
    this.summaryFile = options.summaryFile ?? process.env['GITHUB_STEP_SUMMARY'];
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: unknown, suite: { allTests(): Attempted[] }): void {
    this.suite = suite;
  }

  onEnd(): void {
    if (!this.summaryFile || !this.suite) return;
    const tests: SecondLook[] = [];
    for (const test of this.suite.allTests()) {
      const entry = secondLook(test, repoRoot);
      if (entry) tests.push(entry);
    }
    // A line of its own first: an earlier step may have left its last line open.
    appendFileSync(this.summaryFile, `\n${retriedSummary(tests)}`);
  }
}
