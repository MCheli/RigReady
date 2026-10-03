import { defineConfig } from '@playwright/test';

/** Scenario end-to-end tests against the built app (npm run test:e2e). */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  outputDir: './artifacts/playwright',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list']],
});
