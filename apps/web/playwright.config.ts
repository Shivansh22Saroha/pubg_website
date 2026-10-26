import { defineConfig, devices } from '@playwright/test';

/**
 * Two modes:
 * - `prod` (default — `pnpm test:e2e`, and CI): its own API on :4200 (no watch mode) and a
 *   production build of the web app on :3200. Dev-server restarts can't break the run.
 * - `dev` (`pnpm test:e2e:dev`): reuses the `pnpm dev` servers on :3000 / :4000 — faster loop.
 */
export function makeConfig(mode: 'prod' | 'dev') {
  const isCI = Boolean(process.env.CI);
  const WEB_PORT = mode === 'dev' ? 3000 : 3200;
  const API_PORT = mode === 'dev' ? 4000 : 4200;
  const origin = `http://localhost:${WEB_PORT}`;

  const prodEnv = {
    // web build: bake in the proxy to our API, own dist dir, own origin
    E2E_API_PROXY: 'true',
    NEXT_DIST_DIR: '.next-e2e',
    INTERNAL_API_URL: `http://localhost:${API_PORT}`,
    NEXT_PUBLIC_APP_ORIGIN: origin,
    NEXT_PUBLIC_API_BASE: '/api/v1',
    NEXT_PUBLIC_SOCKET_PATH: '/realtime',
    NEXT_PUBLIC_TILES_BASE_URL: '/tiles',
    // websockets don't pass through Next rewrites: the socket talks to the API directly
    NEXT_PUBLIC_SOCKET_URL: `http://localhost:${API_PORT}`,
    // test-only: keep window.__rlDebug in this production build
    NEXT_PUBLIC_E2E_DEBUG: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  return defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    // the realtime tests assert ≤ 1 s sync; with half of a 12-thread machine's cores each test
    // runs two browsers next to Next, the API and Dockerised Postgres, and latency spikes past it
    workers: isCI ? undefined : 3,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
    // dev mode compiles each route on first visit (several seconds for the map/room bundles)
    expect: { timeout: 20_000 },
    use: {
      baseURL: origin,
      trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer:
      mode === 'dev'
        ? [
            {
              command: 'pnpm --dir ../server exec tsx --env-file-if-exists=.env src/index.ts',
              url: `http://localhost:${API_PORT}/api/health`,
              reuseExistingServer: true,
              timeout: 120_000,
            },
            {
              command: `pnpm exec next dev --port ${WEB_PORT}`,
              url: `${origin}/`,
              reuseExistingServer: true,
              timeout: 180_000,
            },
          ]
        : [
            {
              // API without watch mode, under a supervisor the tests can restart (e2e/fixtures
              // `restartApi`); DB/Redis from apps/server/.env (CI: the workflow env)
              command: 'pnpm --dir ../server exec tsx scripts/e2e-api.ts',
              url: `http://localhost:${API_PORT}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
              env: {
                PORT: String(API_PORT),
                APP_ORIGIN: origin,
                RATE_LIMITS_ENABLED: 'false',
                LOG_LEVEL: 'warn',
                E2E_CONTROL_PORT: '4299',
              },
            },
            {
              command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
              url: `${origin}/`,
              reuseExistingServer: false,
              timeout: 300_000,
              env: prodEnv,
            },
          ],
  });
}

export default makeConfig(process.env.E2E_MODE === 'dev' ? 'dev' : 'prod');
