import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Generous: several agents and the e2e suite often share this machine.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/legacy/**', 'node_modules/**'],
    environment: 'node',
    globalSetup: ['tests/cleanTemp.ts'],
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
