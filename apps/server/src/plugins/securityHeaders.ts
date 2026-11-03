import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

/**
 * Security headers on every API response (SECURITY §5 T4). The API only returns JSON, so its
 * CSP denies everything; pages get their nonce CSP from the web app (src/proxy.ts). Caddy sets
 * the same HSTS / nosniff / Referrer-Policy at the edge — these keep the API safe without it.
 */
export async function registerSecurityHeaders(app: FastifyInstance, https: boolean) {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      // frame-ancestors / base-uri / form-action don't fall back to default-src
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // HSTS only means something over HTTPS (COOKIE_SECURE=true ⇔ deployed behind TLS)
    hsts: https ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Socket.IO's polling transport is plain HTTP on the same server; helmet only sees Fastify routes
  });
}
