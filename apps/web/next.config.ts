import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
/** E2E runs a production build that has to stand in for Caddy (see playwright.config.ts). */
const e2eProxy = process.env.E2E_API_PROXY === 'true';
const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // separate output for the E2E build so it never mixes with `pnpm build`
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Dev (and E2E builds): proxy API + realtime through Next so the browser sees one origin and
  // cookies behave exactly like prod (ENVIRONMENT "Dev proxying"). In prod Caddy routes these.
  rewrites() {
    if (!isDev && !e2eProxy) return Promise.resolve([]);
    return Promise.resolve([
      { source: '/api/:path*', destination: `${internalApiUrl}/api/:path*` },
      { source: '/realtime/:path*', destination: `${internalApiUrl}/realtime/:path*` },
    ]);
  },
};

export default nextConfig;
