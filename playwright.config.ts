import { defineConfig } from '@playwright/test';

/**
 * GitHub's shared runners are several times slower than a desk PC (two cores, no GPU). The
 * steps and what they must show are the same there; only the patience differs.
 */
const slow = !!process.env['CI'];

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
  reporter: [['list']],
});
