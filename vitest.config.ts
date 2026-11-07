import { defineConfig } from 'vitest/config';

/**
 * GitHub's shared runners are several times slower than a desk PC, and for minutes at a
 * time far slower than that: on 2026-11-06 the tree that had passed an hour earlier saw
 * one-second tests take thirty while the runner's disk stalled, and five of them timed out.
 * The tests and what they assert are the same there; only the patience differs, as in
 * playwright.config.ts. On a desk PC a hung test still fails in 30 seconds.
 */
const slow = !!process.env['CI'];

export default defineConfig({
  test: {
    // Generous: several agents and the e2e suite often share this machine.
    testTimeout: slow ? 120_000 : 30_000,
    hookTimeout: slow ? 120_000 : 30_000,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/legacy/**', 'node_modules/**'],
    environment: 'node',
    globalSetup: ['tests/cleanTemp.ts'],
    // Fails any test in which a feature changes a file below Program Files (PLAT-007).
    setupFiles: ['tests/guardProgramFiles.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: [
        'src/core/**/*.ts',
        'src/shared/**/*.ts',
        'src/platform/fake/**/*.ts',
        'src/platform/node/**/*.ts',
        'src/features/*/core/**/*.ts',
        'src/features/games/*/**/*.ts',
        'scripts/lib/**/*.ts',
      ],
      exclude: ['**/*.test.ts', 'src/core/ports/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
