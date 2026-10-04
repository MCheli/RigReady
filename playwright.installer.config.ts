import { defineConfig } from '@playwright/test';

/**
 * Installer smoke test (npm run smoke:installer): installs, updates and removes the
 * "RigReady Test" variant built by scripts/build-test-installer.mjs. Not part of
 * `npm run check`; it runs real installers on this PC.
 */
export default defineConfig({
  testDir: './tests/installer',
  testMatch: '**/*.e2e.ts',
  outputDir: './artifacts/playwright-installer',
  timeout: 900_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
