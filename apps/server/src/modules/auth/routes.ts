import {
  LoginBodySchema,
  RegisterBodySchema,
  UserResponseSchema,
  UsernameAvailableQuerySchema,
  UsernameAvailableResponseSchema,
} from '@rotationlab/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { hashIp } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { LIMITS, fixedWindowLimit } from '../../plugins/rateLimit.js';
import type { AuthCookies } from './cookies.js';
import type { AuthService } from './service.js';

export interface AuthRouteDeps {
  auth: AuthService;
  cookies: AuthCookies;
  redis: Redis;
  rateLimits: boolean;
  ipHashSalt: string;
}

/** /api/v1/auth/* (API_SPEC §2). Email verification / reset (P1) arrive with EMAIL_ENABLED. */
export const authRoutes: FastifyPluginCallbackZod<AuthRouteDeps> = (app, deps, done) => {
  const { auth, cookies } = deps;
  const meta = (req: FastifyRequest) => ({
    userAgent: req.headers['user-agent'] ?? null,
    ipHash: hashIp(req.ip, deps.ipHashSalt),
  });

  app.post(
    '/register',
    {
      config: { access: 'public', rateLimit: LIMITS.register },
      preHandler: fixedWindowLimit(
        deps.redis,
        deps.rateLimits,
        'register-hour',
        LIMITS.registerHourly,
      ),
      schema: { body: RegisterBodySchema, response: { 201: UserResponseSchema } },
    },
    async (req, reply) => {
      const s = await auth.register(req.body, meta(req));
      cookies.set(reply, s);
      return reply.status(201).send({ user: s.user });
    },
  );

  app.post(
    '/login',
    {
      config: { access: 'public', rateLimit: LIMITS.login },
      schema: { body: LoginBodySchema, response: { 200: UserResponseSchema } },
    },
    async (req, reply) => {
      const s = await auth.login(req.body.identifier, req.body.password, meta(req));
      cookies.set(reply, s);
      return { user: s.user };
    },
  );

  app.post('/refresh', { config: { access: 'public' } }, async (req, reply) => {
    const raw = cookies.readRefresh(req);
    if (!raw) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
    try {
      cookies.set(reply, await auth.refresh(raw, meta(req)));
    } catch (err) {
      // 409 = another tab refreshed a moment ago; its new cookies are already in the browser
      if (!(err instanceof AppError && err.code === 'CONFLICT')) cookies.clear(reply);
      throw err;
    }
    return reply.status(204).send();
  });

  // Works with either cookie so an expired access token can still log out (idempotent).
  app.post('/logout', { config: { access: 'public' } }, async (req, reply) => {
    const user = await app.authenticate(req).catch(() => null);
    await auth.logout(cookies.readRefresh(req), user?.sid);
    cookies.clear(reply);
    return reply.status(204).send();
  });

  app.post('/logout-all', { config: { access: 'user' } }, async (req, reply) => {
    const user = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
    await auth.logoutAll(user.id, user.sid);
    cookies.clear(reply);
    return reply.status(204).send();
  });

  app.get(
    '/username-available',
    {
      config: { access: 'public', rateLimit: LIMITS.usernameAvailable },
      schema: {
        querystring: UsernameAvailableQuerySchema,
        response: { 200: UsernameAvailableResponseSchema },
      },
    },
    async (req) => ({ available: await auth.usernameAvailable(req.query.u) }),
  );

  done();
};
