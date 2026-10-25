import { AppError } from '../../lib/errors.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  replacedBy: string | null;
  userAgent: string | null;
  ipHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export type NewRefreshToken = Omit<RefreshTokenRecord, 'replacedBy' | 'revokedAt'>;

/** Operations available inside a transaction (row lock held on the token being rotated). */
export interface RefreshTokenTx {
  findByHashForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null>;
  create(token: NewRefreshToken): Promise<void>;
  markRotated(id: string, replacedBy: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
}

export interface RefreshTokenStore {
  transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T>;
  create(token: NewRefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  /** revokes every live family of the user except `exceptFamilyId`; returns revoked family ids */
  revokeAllForUser(userId: string, at: Date, exceptFamilyId?: string): Promise<string[]>;
  /** live (unrevoked, unexpired) tokens of the user, one per family */
  listLive(userId: string, at: Date): Promise<RefreshTokenRecord[]>;
  /** earliest token of each family = when the session started */
  familyStarts(familyIds: string[]): Promise<Map<string, Date>>;
}

export interface SessionMeta {
  userAgent?: string | null | undefined;
  ipHash?: string | null | undefined;
}

export interface IssuedRefresh {
  raw: string;
  userId: string;
  familyId: string;
}

type RotateOutcome =
  | { kind: 'ok'; issued: IssuedRefresh }
  | { kind: 'invalid' }
  | { kind: 'concurrent' }
  | { kind: 'reuse'; userId: string; familyId: string };

/**
 * Refresh tokens (SECURITY A4): 256-bit opaque, only SHA-256 stored, 30-day expiry, rotated on
 * every use. Presenting an already-rotated token revokes the whole family (theft detection) —
 * unless it happens within `reuseGraceSec` of the rotation, which is two tabs refreshing at once.
 */
export function createSessionService(opts: {
  store: RefreshTokenStore;
  ttlDays: number;
  reuseGraceSec: number;
  now?: () => Date;
  onReuse?: (info: { userId: string; familyId: string }) => void;
}) {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  const ttlMs = opts.ttlDays * 24 * 3600 * 1000;

  function build(userId: string, familyId: string, meta: SessionMeta, at: Date) {
    const raw = randomToken();
    const token: NewRefreshToken = {
      id: newId(),
      userId,
      familyId,
      tokenHash: sha256Hex(raw),
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
      ipHash: meta.ipHash ?? null,
      expiresAt: new Date(at.getTime() + ttlMs),
      createdAt: at,
    };
    return { raw, token };
  }

  return {
    /** New session (login/register). The family id doubles as the session id (`sid`). */
    async start(userId: string, meta: SessionMeta = {}): Promise<IssuedRefresh> {
      const familyId = newId();
      const { raw, token } = build(userId, familyId, meta, now());
      await store.create(token);
      return { raw, userId, familyId };
    },

    async rotate(raw: string, meta: SessionMeta = {}): Promise<IssuedRefresh> {
      const at = now();
      const outcome = await store.transaction<RotateOutcome>(async (tx) => {
        const current = await tx.findByHashForUpdate(sha256Hex(raw));
        if (!current) return { kind: 'invalid' };
        if (current.replacedBy) {
          const rotatedAt = current.revokedAt?.getTime() ?? 0;
          if (at.getTime() - rotatedAt <= opts.reuseGraceSec * 1000) return { kind: 'concurrent' };
          await tx.revokeFamily(current.familyId, at);
          // returned (not thrown) so the revocation commits
          return { kind: 'reuse', userId: current.userId, familyId: current.familyId };
        }
        if (current.revokedAt || current.expiresAt <= at) return { kind: 'invalid' };

        const next = build(current.userId, current.familyId, meta, at);
        await tx.create(next.token);
        await tx.markRotated(current.id, next.token.id, at);
        return {
          kind: 'ok',
          issued: { raw: next.raw, userId: current.userId, familyId: current.familyId },
        };
      });

      switch (outcome.kind) {
        case 'ok':
          return outcome.issued;
        case 'concurrent':
          throw new AppError('CONFLICT', 'Session was just refreshed by another request');
        case 'reuse':
          opts.onReuse?.({ userId: outcome.userId, familyId: outcome.familyId });
          throw new AppError('UNAUTHENTICATED', 'Session expired, please log in again');
        case 'invalid':
          throw new AppError('UNAUTHENTICATED', 'Session expired, please log in again');
      }
    },

    /** Logout with a refresh cookie: revoke its family. Returns the family id, if any. */
    async revokeByToken(raw: string): Promise<string | null> {
      const token = await store.findByHash(sha256Hex(raw));
      if (!token) return null;
      await store.revokeFamily(token.familyId, now());
      return token.familyId;
    },

    async revokeFamily(familyId: string): Promise<void> {
      await store.revokeFamily(familyId, now());
    },

    revokeAllForUser(userId: string, exceptFamilyId?: string): Promise<string[]> {
      return store.revokeAllForUser(userId, now(), exceptFamilyId);
    },

    async list(userId: string) {
      const live = await store.listLive(userId, now());
      const starts = await store.familyStarts(live.map((t) => t.familyId));
      return live.map((t) => ({
        familyId: t.familyId,
        userAgent: t.userAgent,
        startedAt: starts.get(t.familyId) ?? t.createdAt,
      }));
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;
