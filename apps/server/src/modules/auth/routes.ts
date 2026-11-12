import {
  ForgotPasswordBodySchema,
  GoogleCallbackQuerySchema,
  GoogleStartQuerySchema,
  LoginBodySchema,
  RegisterBodySchema,
  ResetPasswordBodySchema,
  SocketTicketResponseSchema,
  VerifyEmailBodySchema,
  UserResponseSchema,
  UsernameAvailableQuerySchema,
  UsernameAvailableResponseSchema,
} from '@rotationlab/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { hashIp } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { LIMITS, byUser, fixedWindowLimit } from '../../plugins/rateLimit.js';
import type { AuthCookies } from './cookies.js';
import type { EmailFlows } from './emailFlows.js';
import { pkceChallenge, randomToken, safeNext, type GoogleClient } from './google.js';
import type { AuthService } from './service.js';
import type { SocketTickets } from './socketTickets.js';
import type { TokenService } from './tokens.js';

export interface AuthRouteDeps {
  /** Sign in with Google (F17); null = not configured, its routes answer 404 */
  google: GoogleClient | null;
  cookieSecure: boolean;
  auth: AuthService;
  cookies: AuthCookies;
  redis: Redis;
  rateLimits: boolean;
  ipHashSalt: string;
  email: EmailFlows;
  tokens: TokenService;
  tickets: SocketTickets;
}

/**
 * /api/v1/auth/* (API_SPEC §2). Email verification / reset (AUTH-7) are always registered and
 * answer 404 while EMAIL_ENABLED=false.
 */
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
      deps.email.afterRegister(s.user.id);
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

  // ---- socket ticket (SECURITY A11): the handshake's credential when the API is cross-site ----
  app.post(
    '/socket-ticket',
    {
      config: { access: 'user' },
      preHandler: fixedWindowLimit(
        deps.redis,
        deps.rateLimits,
        'socket-ticket',
        LIMITS.socketTicket,
        byUser,
      ),
      schema: { response: { 200: SocketTicketResponseSchema } },
    },
    async (req) => {
      const user = req.user;
      const token = cookies.readAccess(req);
      if (!user || !token) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
      // the access token was verified by the preHandler; read its exp for the socket's timer
      const { exp } = await deps.tokens.verify(token);
      return { ticket: await deps.tickets.issue({ userId: user.id, sid: user.sid, exp }) };
    },
  );

  // ---- email flows (SECURITY A9) -------------------------------------------------------
  // ---- Sign in with Google (F17, SECURITY A12) ------------------------------------------
  // state + PKCE verifier + nonce live 10 min in Redis, single use; the state is also bound to
  // this browser by a short cookie, so a link someone else started can't log you in (login CSRF)
  const G_COOKIE = 'rl_goauth';
  const G_TTL = 600;
  const gKey = (state: string) => `rt:goauth:${state}`;
  const failTo = (reason: string) => `/login?error=${encodeURIComponent(reason)}`;

  app.get(
    '/google/start',
    {
      config: { access: 'public', rateLimit: LIMITS.login },
      schema: { querystring: GoogleStartQuerySchema },
    },
    async (req, reply) => {
      if (!deps.google) throw new AppError('NOT_FOUND', 'Not found');
      const state = randomToken();
      const verifier = randomToken();
      const nonce = randomToken();
      const next = safeNext(req.query.next);
      await deps.redis.set(gKey(state), JSON.stringify({ verifier, nonce, next }), 'EX', G_TTL);
      reply.setCookie(G_COOKIE, state, {
        httpOnly: true,
        secure: deps.cookieSecure,
        sameSite: 'lax', // must ride along on Google's top-level redirect back to us
        path: '/api/v1/auth/google',
        maxAge: G_TTL,
      });
      reply.header('cache-control', 'no-store');
      return reply.redirect(
        deps.google.authUrl({ state, challenge: pkceChallenge(verifier), nonce }),
        303,
      );
    },
  );

  app.get(
    '/google/callback',
    {
      config: { access: 'public', rateLimit: LIMITS.login },
      schema: { querystring: GoogleCallbackQuerySchema },
    },
    async (req, reply) => {
      if (!deps.google) throw new AppError('NOT_FOUND', 'Not found');
      reply.header('cache-control', 'no-store');
      const cookieState = req.cookies[G_COOKIE];
      reply.clearCookie(G_COOKIE, { path: '/api/v1/auth/google' });
      const { code, state, error } = req.query;
      if (error === 'access_denied') return reply.redirect(failTo('google_cancelled'), 303);
      if (!code || !state || !cookieState || cookieState !== state) {
        return reply.redirect(failTo('google'), 303);
      }
      const saved = await deps.redis.getdel(gKey(state));
      if (!saved) return reply.redirect(failTo('google_expired'), 303);
      const { verifier, nonce, next } = JSON.parse(saved) as {
        verifier: string;
        nonce: string;
        next: string;
      };
      let to: string;
      try {
        const profile = await deps.google.exchange({ code, verifier, nonce });
        const s = await auth.loginWithGoogle(profile, meta(req));
        cookies.set(reply, s);
        req.log.info({ event: 'auth.google', created: s.created }, 'google sign-in');
        to = s.created ? '/dashboard?welcome=google' : safeNext(next);
      } catch (err) {
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'google sign-in failed',
        );
        return reply.redirect(failTo('google'), 303);
      }
      return reply.redirect(to, 303);
    },
  );

  app.post(
    '/verify-email',
    {
      config: { access: 'public', rateLimit: LIMITS.emailToken },
      schema: { body: VerifyEmailBodySchema },
    },
    async (req, reply) => {
      await deps.email.verify(req.body.token);
      return reply.status(204).send();
    },
  );

  app.post(
    '/resend-verification',
    {
      config: { access: 'user' },
      preHandler: fixedWindowLimit(
        deps.redis,
        deps.rateLimits,
        'verify-resend',
        LIMITS.verifyResendHourly,
        byUser,
      ),
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
      await deps.email.resendVerification(user.id);
      return reply.status(202).send();
    },
  );

  app.post(
    '/forgot-password',
    {
      config: { access: 'public' },
      preHandler: [
        fixedWindowLimit(deps.redis, deps.rateLimits, 'forgot-ip', LIMITS.forgotIpHourly),
        fixedWindowLimit(
          deps.redis,
          deps.rateLimits,
          'forgot-email',
          LIMITS.forgotEmailHourly,
          (r) => `e:${(r.body as { email?: string } | undefined)?.email ?? ''}`,
        ),
      ],
      schema: { body: ForgotPasswordBodySchema },
    },
    async (req, reply) => {
      deps.email.forgot(req.body.email); // same 202 whether or not the address exists
      return reply.status(202).send();
    },
  );

  app.post(
    '/reset-password',
    {
      config: { access: 'public', rateLimit: LIMITS.emailToken },
      schema: { body: ResetPasswordBodySchema },
    },
    async (req, reply) => {
      await deps.email.reset(req.body.token, req.body.password);
      cookies.clear(reply); // every session ended, this browser's too
      return reply.status(204).send();
    },
  );

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
