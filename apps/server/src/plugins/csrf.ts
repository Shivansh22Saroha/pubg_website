import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@rotationlab/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF (API_SPEC §1.2, SECURITY T3): every state-changing request needs
 * `X-Requested-With: rotationlab` AND an `Origin` exactly equal to APP_ORIGIN.
 * SameSite cookies are the third layer. A missing Origin is rejected.
 */
export function registerCsrf(app: FastifyInstance, appOrigin: string) {
  app.addHook('onRequest', (request, _reply, done) => {
    if (SAFE_METHODS.has(request.method)) {
      done();
      return;
    }
    const marker = request.headers[CSRF_HEADER];
    const origin = request.headers.origin;
    if (marker !== CSRF_HEADER_VALUE || origin !== appOrigin) {
      done(new AppError('CSRF_FAILED', 'Cross-site request rejected'));
      return;
    }
    done();
  });
}
