import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

const isDev = process.env.NODE_ENV !== 'production';
/** E2E runs a production build that has to stand in for Caddy (see playwright.config.ts). */
const e2eProxy = process.env.E2E_API_PROXY === 'true';
const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
/**
 * Vercel + Render (DEPLOYMENT §10): the API lives on another site. REST goes through this
 * rewrite so the browser only ever talks to the web origin and the auth cookies stay
 * first-party; the websocket goes straight to the API with a ticket (SECURITY A11).
 */
const apiProxyUrl = process.env.API_PROXY_URL?.replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // always defined, so `=== 'true'` folds at build time and dead debug code is dropped
  env: {
    NEXT_PUBLIC_E2E_DEBUG: process.env.NEXT_PUBLIC_E2E_DEBUG ?? 'false',
    // Sentry release tag (DEPLOYMENT §7)
    NEXT_PUBLIC_RELEASE: version,
  },
  // separate output for the E2E build so it never mixes with `pnpm build`
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Dev (and E2E builds): proxy API + realtime through Next so the browser sees one origin and
  // cookies behave exactly like prod (ENVIRONMENT "Dev proxying"). In prod Caddy routes these.
  rewrites() {
    if (!isDev && !e2eProxy) {
      return Promise.resolve(
        apiProxyUrl ? [{ source: '/api/:path*', destination: `${apiProxyUrl}/api/:path*` }] : [],
      );
    }
    return Promise.resolve([
      { source: '/api/:path*', destination: `${internalApiUrl}/api/:path*` },
      { source: '/realtime/:path*', destination: `${internalApiUrl}/realtime/:path*` },
    ]);
  },
};

export default nextConfig;
