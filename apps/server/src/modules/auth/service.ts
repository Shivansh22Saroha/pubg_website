import { Prisma, type PrismaClient, type User } from '@prisma/client';
import {
  USERNAME_PATTERN,
  UserPrefsSchema,
  type ChangePasswordBodySchema,
  type UpdatePrefsBodySchema,
  type UserPrefs,
  type Me,
  type RegisterBodySchema,
  type Session,
  type UpdateMeBodySchema,
} from '@rotationlab/shared';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { Lockout } from './lockout.js';
import { assertPasswordPolicy, type PasswordHasher } from './passwords.js';
import type { RevocationList } from './revocation.js';
import type { SessionMeta, SessionService } from './sessions.js';
import type { TokenService } from './tokens.js';

export interface AuthDeps {
  prisma: PrismaClient;
  passwords: PasswordHasher;
  tokens: TokenService;
  sessions: SessionService;
  lockout: Lockout;
  revocations: RevocationList;
}

export interface IssuedSession {
  user: Me;
  access: string;
  refresh: string;
}

const GENERIC_LOGIN_ERROR = 'Email/username or password is incorrect';

export function toMe(u: User): Me {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    ign: u.ign,
    avatarColor: u.avatarColor,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
    prefs: readPrefs(u.prefs),
    isAdmin: false,
  };
}

/** `users.prefs` → known keys with defaults; anything unexpected is ignored, never an error. */
export function readPrefs(raw: unknown): UserPrefs {
  const parsed = UserPrefsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : UserPrefsSchema.parse({});
}

function uniqueViolation(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target;
    return Array.isArray(target) ? target.join(',') : String(target);
  }
  return null;
}

export function createAuthService(d: AuthDeps) {
  const { prisma } = d;

  async function activeUser(id: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
    return user;
  }

  async function issue(user: User, meta: SessionMeta): Promise<IssuedSession> {
    const refresh = await d.sessions.start(user.id, meta);
    const access = await d.tokens.sign({ sub: user.id, sid: refresh.familyId });
    return { user: toMe(user), access, refresh: refresh.raw };
  }

  return {
    async register(
      body: z.output<typeof RegisterBodySchema>,
      meta: SessionMeta,
    ): Promise<IssuedSession> {
      assertPasswordPolicy(body.password);
      const taken = await prisma.user.findFirst({
        where: { OR: [{ email: body.email }, { username: body.username }] },
        select: { email: true, username: true },
      });
      if (taken?.username.toLowerCase() === body.username) {
        throw new AppError('USERNAME_TAKEN', 'That username is taken');
      }
      if (taken) throw new AppError('EMAIL_TAKEN', 'An account with that email already exists');

      const passwordHash = await d.passwords.hash(body.password);
      let user: User;
      try {
        user = await prisma.user.create({
          data: {
            id: newId(),
            email: body.email,
            username: body.username,
            displayName: body.displayName ?? body.username,
            passwordHash,
          },
        });
      } catch (err) {
        const target = uniqueViolation(err);
        if (target?.includes('username'))
          throw new AppError('USERNAME_TAKEN', 'That username is taken');
        if (target) throw new AppError('EMAIL_TAKEN', 'An account with that email already exists');
        throw err;
      }
      return issue(user, meta);
    },

    async login(identifier: string, password: string, meta: SessionMeta): Promise<IssuedSession> {
      const id = identifier.trim().toLowerCase();
      const found = await prisma.user.findUnique({
        where: id.includes('@') ? { email: id } : { username: id },
      });
      const user = found && !found.deletedAt ? found : null;

      if (!user) {
        await d.passwords.dummyVerify(password); // equalise timing with the real path
        throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
      }
      const lockedUntil = await d.lockout.lockedUntil(user);
      if (lockedUntil) {
        throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', [
          { path: 'lockedUntil', issue: lockedUntil.toISOString() },
        ]);
      }
      if (!(await d.passwords.verify(user.passwordHash, password))) {
        await d.lockout.recordFailure(user.id);
        throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
      }
      await d.lockout.recordSuccess(user.id);
      return issue(user, meta);
    },

    async refresh(rawRefresh: string, meta: SessionMeta) {
      const next = await d.sessions.rotate(rawRefresh, meta);
      await activeUser(next.userId);
      const access = await d.tokens.sign({ sub: next.userId, sid: next.familyId });
      return { access, refresh: next.raw };
    },

    async logout(rawRefresh: string | undefined, sid: string | undefined): Promise<void> {
      const family = rawRefresh ? await d.sessions.revokeByToken(rawRefresh) : null;
      if (!family && sid) await d.sessions.revokeFamily(sid);
      await d.revocations.revoke([family ?? sid].filter((s): s is string => Boolean(s)));
    },

    async logoutAll(userId: string, sid: string): Promise<void> {
      const families = await d.sessions.revokeAllForUser(userId);
      await d.revocations.revoke([...new Set([...families, sid])]);
    },

    async usernameAvailable(u: string): Promise<boolean> {
      const username = u.trim().toLowerCase();
      if (!USERNAME_PATTERN.test(username)) return false;
      return (await prisma.user.count({ where: { username } })) === 0;
    },

    // ---- /me -------------------------------------------------------------------------

    me: async (userId: string) => toMe(await activeUser(userId)),

    async updateMe(userId: string, body: z.output<typeof UpdateMeBodySchema>) {
      await activeUser(userId);
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.ign !== undefined ? { ign: body.ign } : {}),
          ...(body.avatarColor !== undefined
            ? { avatarColor: body.avatarColor.toUpperCase() }
            : {}),
        },
      });
      return toMe(user);
    },

    /**
     * Phase 9: merge into `users.prefs` in one statement (`prefs || patch`), so two devices
     * setting different keys never overwrite each other.
     */
    async updatePrefs(userId: string, patch: z.output<typeof UpdatePrefsBodySchema>) {
      await activeUser(userId);
      await prisma.$executeRaw`UPDATE users SET prefs = prefs || ${JSON.stringify(patch)}::jsonb WHERE id = ${userId}::uuid`;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      return readPrefs(user.prefs);
    },

    /** AUTH-6 / SECURITY A8: requires the current password, revokes every other session. */
    async changePassword(
      userId: string,
      sid: string,
      body: z.output<typeof ChangePasswordBodySchema>,
    ): Promise<void> {
      const user = await activeUser(userId);
      if (!(await d.passwords.verify(user.passwordHash, body.currentPassword))) {
        throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      assertPasswordPolicy(body.newPassword, 'newPassword');
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await d.passwords.hash(body.newPassword) },
      });
      await d.revocations.revoke(await d.sessions.revokeAllForUser(userId, sid));
    },

    async sessions(userId: string, sid: string): Promise<Session[]> {
      const list = await d.sessions.list(userId);
      return list.map((s) => ({
        id: s.familyId,
        userAgent: s.userAgent,
        createdAt: s.startedAt.toISOString(),
        current: s.familyId === sid,
      }));
    },

    async revokeSession(userId: string, familyId: string): Promise<void> {
      const owned = await prisma.refreshToken.findFirst({
        where: { userId, familyId },
        select: { id: true },
      });
      if (!owned) throw new AppError('NOT_FOUND', 'Session not found');
      await d.sessions.revokeFamily(familyId);
      await d.revocations.revoke([familyId]);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
