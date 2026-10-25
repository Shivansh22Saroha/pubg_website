import { defineConfig } from 'vitest/config';

// Needs Postgres + Redis (docker compose locally, service containers in CI). See globalSetup.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/globalSetup.ts'],
    fileParallelism: false, // one shared database
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
