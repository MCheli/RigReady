import { defineConfig } from '@playwright/test';

/**
 * GitHub's shared runners are several times slower than a desk PC (two cores, no GPU). The
 * steps and what they must show are the same there; only the patience differs.
 */
const slow = !!process.env['CI'];

/**
 * CI runs the suite as shards on runners of their own (ci.yml): E2E_SHARD=2/4 is the second
 * quarter of the tests, split by file. Unset, every test runs, as on a desk PC.
 */
const shard = /^(\d+)\/(\d+)$/.exec(process.env['E2E_SHARD'] ?? '');

/** Scenario end-to-end tests against the built app (npm run test:e2e). */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  outputDir: './artifacts/playwright',
  timeout: slow ? 180_000 : 60_000,
  expect: { timeout: slow ? 30_000 : 10_000 },
  retries: slow ? 1 : 0,
  workers: 2,
  shard: shard ? { current: Number(shard[1]), total: Number(shard[2]) } : null,
  // The second reporter adds the tests that passed only at a second attempt to the job
  // summary on GitHub, so a green run does not hide them.
  reporter: [['list'], ['./tests/e2e/retriedReporter.ts']],
});
