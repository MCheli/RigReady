import { defineConfig } from 'vitest/config';

// Real-hardware checks. Read-only unless RIGREADY_RIG_APPLY=1.
export default defineConfig({
  test: {
    include: ['tests/rig/**/*.rig.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
