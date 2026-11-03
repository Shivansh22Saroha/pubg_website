import { z } from 'zod';

/**
 * Browsers run under a nonce CSP without `'unsafe-eval'` (SECURITY §5 T4). Zod 4 would probe
 * `new Function` while building object schemas — the probe is caught, but the browser still
 * reports a CSP violation — and then compile a JIT parser. Jitless skips both. It must run
 * before any schema is constructed, so `index.ts` imports this first. The server keeps the JIT.
 */
if ('window' in globalThis) z.config({ jitless: true });
