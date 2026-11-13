import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';

/** Routes that keep answering in maintenance: uptime checks and scraping must not page anyone. */
const ALWAYS_ON = new Set(['/api/health', '/api/live', '/metrics']);

/** DEPLOYMENT §7: MAINTENANCE=true → 503 MAINTENANCE for every other request. */
export function registerMaintenance(app: FastifyInstance, enabled: boolean) {
  if (!enabled) return;
  app.addHook('onRequest', (request, reply, done) => {
    if (ALWAYS_ON.has(request.url.split('?')[0] ?? '')) {
      done();
      return;
    }
    void reply.header('retry-after', '300');
    done(new AppError('MAINTENANCE', 'RotationLab is down for maintenance. Back shortly.'));
  });
}
