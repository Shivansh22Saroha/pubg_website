import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Dev only: proxy API + realtime through Next so the browser sees one origin and cookies behave
  // exactly like prod (ENVIRONMENT "Dev proxying"). In prod Caddy routes these paths.
  rewrites() {
    if (!isDev) return Promise.resolve([]);
    return Promise.resolve([
      { source: '/api/:path*', destination: `${internalApiUrl}/api/:path*` },
      { source: '/realtime/:path*', destination: `${internalApiUrl}/realtime/:path*` },
    ]);
  },
};

export default nextConfig;
