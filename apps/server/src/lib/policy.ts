import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

/**
 * Authorization policy (SECURITY §3). Every route MUST declare `config.access`; the server
 * refuses to start otherwise, and the authz-matrix test enumerates the same table.
 *
 * - `public` — no authentication (may still read the session if present)
 * - `user`   — any authenticated user
 * Room-scoped levels (member / editor / owner) are added in Phase 4.
 */
export const ACCESS_LEVELS = ['public', 'user'] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

export interface AuthUser {
  id: string;
  /** session id = refresh-token family */
  sid: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** METHOD + url of every registered route with its access level (authz matrix harness) */
    routeTable: { method: string; url: string; access: Access }[];
    authenticate(request: FastifyRequest): Promise<AuthUser>;
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
  return request.user;
}

/** Installs the onRoute check and the preHandler that enforces `config.access`. */
export function registerPolicy(app: FastifyInstance) {
  app.decorate('routeTable', []);
  app.decorateRequest('user', null);

  app.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    if (methods.every((m) => m === 'HEAD')) return; // auto-generated HEAD twins of GET routes
    const access = route.config?.access;
    if (!access || !(ACCESS_LEVELS as readonly string[]).includes(access)) {
      throw new Error(`route ${methods.join(',')} ${route.url} must declare config.access`);
    }
    for (const method of methods) app.routeTable.push({ method, url: route.url, access });
  });

  app.addHook('preHandler', async (request) => {
    const access = request.routeOptions.config.access;
    if (access === 'user') request.user = await app.authenticate(request);
  });
}
