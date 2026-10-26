import { defineConfig } from '@playwright/test';
import { makeConfig } from './playwright.config';

/**
 * `pnpm --filter web test:lighthouse` (TESTING §7): Lighthouse on landing + dashboard against
 * the same production build and API as `pnpm test:e2e`. Separate from the E2E run: it is slow,
 * needs a quiet machine, and runs one page at a time.
 */
const base = makeConfig('prod');
export default defineConfig({
  ...base,
  testDir: './lighthouse',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
});
