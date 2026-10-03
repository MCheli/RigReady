import { defineConfig } from '@playwright/test';

/** Packaged smoke test against release/win-unpacked (npm run smoke:packaged). */
export default defineConfig({
  testDir: './tests/packaged',
  testMatch: '**/*.e2e.ts',
  outputDir: './artifacts/playwright-packaged',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
