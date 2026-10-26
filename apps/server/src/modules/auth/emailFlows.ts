import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import { resetPasswordMail, verifyEmailMail } from './emails.js';
import type { EmailTokens } from './emailTokens.js';
import type { Lockout } from './lockout.js';
import { assertPasswordPolicy, type PasswordHasher } from './passwords.js';
import type { RevocationList } from './revocation.js';
import type { SessionService } from './sessions.js';

export interface EmailFlowDeps {
  prisma: PrismaClient;
  tokens: EmailTokens;
  mailer: Mailer;
  passwords: PasswordHasher;
  sessions: SessionService;
  revocations: RevocationList;
  lockout: Lockout;
  appOrigin: string;
  enabled: boolean;
  log: FastifyBaseLogger;
}

/**
 * AUTH-7 behind EMAIL_ENABLED: verification and password reset. When disabled, every entry
 * point is a 404 and nothing is sent. Mail goes out after the request's own work, and a mail
 * failure is logged (never the token or the link).
 */
export function createEmailFlows(d: EmailFlowDeps) {
  const link = (path: string, token: string) =>
    `${d.appOrigin.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;

  function requireEnabled() {
    if (!d.enabled) throw new AppError('NOT_FOUND', 'Not found');
  }

  async function sendVerification(userId: string): Promise<void> {
    const user = await d.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.emailVerifiedAt) return;
    const raw = await d.tokens.issue(userId, 'verify');
    await d.mailer.send(verifyEmailMail(user.email, user.displayName, link('/verify-email', raw)));
  }

  return {
    enabled: d.enabled,

    /** On register: best effort, never fails the registration. */
    afterRegister(userId: string): void {
      if (!d.enabled) return;
      sendVerification(userId).catch((err: unknown) => {
        d.log.warn({ err, userId }, 'verification email failed');
      });
    },

    /** The banner's "Resend" (logged in; rate-limited by the route). */
    async resendVerification(userId: string): Promise<void> {
      requireEnabled();
      await sendVerification(userId);
    },

    async verify(raw: string): Promise<void> {
      requireEnabled();
      const userId = await d.tokens.consume(raw, 'verify');
      await d.prisma.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    },

    /**
     * Always resolves at once with nothing to tell (no enumeration, SECURITY A9): the lookup,
     * token and mail happen after the response, for known and unknown addresses alike.
     */
    forgot(email: string): void {
      requireEnabled();
      void (async () => {
        const user = await d.prisma.user.findUnique({ where: { email } });
        if (!user || user.deletedAt) return;
        const raw = await d.tokens.issue(user.id, 'reset');
        await d.mailer.send(
          resetPasswordMail(user.email, user.displayName, link('/reset-password', raw)),
        );
      })().catch((err: unknown) => {
        d.log.warn({ err }, 'password reset email failed');
      });
    },

    /** New password; every session revoked (A8); the lockout cleared; the email counts as verified. */
    async reset(raw: string, password: string): Promise<void> {
      requireEnabled();
      assertPasswordPolicy(password); // before consuming: a weak password doesn't burn the link
      const userId = await d.tokens.consume(raw, 'reset');
      const user = await d.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.deletedAt)
        throw new AppError('BAD_REQUEST', 'This link is invalid or has expired');
      await d.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await d.passwords.hash(password),
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await d.lockout.recordSuccess(userId);
      await d.revocations.revoke(await d.sessions.revokeAllForUser(userId));
    },
  };
}

export type EmailFlows = ReturnType<typeof createEmailFlows>;
