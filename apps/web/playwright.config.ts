import { defineConfig, devices } from '@playwright/test';

// Locally reuse the regular dev server (Next allows only one `next dev` per app); CI serves the build.
const PORT = process.env.CI ? 3100 : 3000;

const isCI = Boolean(process.env.CI);

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
  webServer: {
    // CI runs after `pnpm build`, so serve the production build; locally use the dev server.
    command: isCI ? `pnpm exec next start --port ${PORT}` : `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/maps/erangel`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
