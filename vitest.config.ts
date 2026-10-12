import { devNull } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Keep test runs out of the real m365mutator.log, which operators watch for throttling.
    env: { M365MUTATOR_LOG_PATH: devNull },
  },
});
