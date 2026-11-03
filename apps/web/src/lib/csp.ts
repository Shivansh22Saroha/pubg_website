/**
 * Content-Security-Policy for every page (SECURITY §5 T4), built per request by `src/proxy.ts`
 * with a fresh nonce. Next reads the nonce back from the request's CSP header and puts it on
 * its own scripts; `'strict-dynamic'` lets those load the chunks they import.
 */
export interface CspOptions {
  nonce: string;
  /** dev needs `'unsafe-eval'` (React's dev stack reconstruction) */
  dev: boolean;
  /** NEXT_PUBLIC_TILES_BASE_URL — absolute in prod (R2/CDN), `/tiles` locally */
  tilesBaseUrl: string;
  /** NEXT_PUBLIC_SOCKET_URL — set when the socket bypasses the page origin (dev / E2E) */
  socketUrl?: string | undefined;
  /** NEXT_PUBLIC_SENTRY_DSN — its host receives error reports */
  sentryDsn?: string | undefined;
  /** PUBLIC_ASSETS_BASE_URL (server-only) — board thumbnails on R2 / S3 (Phase 11) */
  assetsBaseUrl?: string | undefined;
}

/** Origin of an absolute http(s) URL; null for relative paths (same origin) or anything else. */
function origin(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** http(s)://host → ws(s)://host, for Socket.IO's websocket upgrade */
const wsOrigin = (o: string) => o.replace(/^http/, 'ws');

export function buildCsp({
  nonce,
  dev,
  tilesBaseUrl,
  socketUrl,
  sentryDsn,
  assetsBaseUrl,
}: CspOptions): string {
  const tiles = origin(tilesBaseUrl);
  const assets = origin(assetsBaseUrl);
  const socket = origin(socketUrl);
  const sentry = origin(sentryDsn);
  const list = (...xs: (string | null | false)[]) => xs.filter(Boolean).join(' ');

  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': list("'self'", `'nonce-${nonce}'`, "'strict-dynamic'", dev && "'unsafe-eval'"),
    // Leaflet and Radix set inline styles (SECURITY T4 keeps 'unsafe-inline' for styles)
    'style-src': "'self' 'unsafe-inline'",
    // next/font self-hosts the fonts
    'font-src': "'self'",
    // blob: PNG export preview; data: Leaflet / inline SVG icons; assets: board thumbnails
    'img-src': list("'self'", 'data:', 'blob:', tiles, assets),
    // tiles: export reads them back through fetch/canvas
    'connect-src': list("'self'", tiles, socket, socket && wsOrigin(socket), sentry),
    'frame-ancestors': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'object-src': "'none'",
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}
