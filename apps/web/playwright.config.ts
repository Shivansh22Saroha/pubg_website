import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// Locally reuse the regular `pnpm dev` servers (Next allows only one `next dev` per app).
// CI starts its own: API on :4000, web on :3100 (its APP_ORIGIN is set in the workflow).
const PORT = isCI ? 3100 : 3000;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API (needs Postgres + Redis + a migrated DB)
      command: 'pnpm --dir ../server exec tsx --env-file-if-exists=.env src/index.ts',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // dev server in CI too: its /api + /realtime rewrites stand in for Caddy
      command: `pnpm exec next dev --port ${PORT}`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
  ],
});
