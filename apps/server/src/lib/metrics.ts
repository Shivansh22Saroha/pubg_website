import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics (DEPLOYMENT §7, ARCHITECTURE §10): process defaults, REST latency by route
 * and connected sockets. One registry per app instance so tests don't share state. `/metrics`
 * is never routed by Caddy (only /api/* and /realtime/* reach the server) and, when
 * METRICS_TOKEN is set, also needs `Authorization: Bearer <token>`.
 */
export function registerMetrics(app: FastifyInstance, token: string | undefined) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const http = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'REST request duration by route template',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url;
    if (route !== '/metrics') {
      http.observe(
        { method: request.method, route: route ?? 'unmatched', status: String(reply.statusCode) },
        reply.elapsedTime / 1000,
      );
    }
    done();
  });

  const expected = token ? Buffer.from(`Bearer ${token}`) : null;
  app.get('/metrics', { config: { access: 'public' } }, async (request, reply) => {
    if (expected) {
      const given = Buffer.from(request.headers.authorization ?? '');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply.status(404).send(); // indistinguishable from "no such route"
      }
    }
    return reply
      .header('content-type', registry.contentType)
      .header('cache-control', 'no-store')
      .send(await registry.metrics());
  });

  return {
    /** connected Socket.IO clients, read at scrape time */
    trackSockets(count: () => number) {
      new Gauge({
        name: 'socketio_connected_clients',
        help: 'Connected Socket.IO clients on this instance',
        registers: [registry],
        collect() {
          this.set(count());
        },
      });
    },
  };
}
