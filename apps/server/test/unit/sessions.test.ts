import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/lib/crypto.js';
import { AppError } from '../../src/lib/errors.js';
import {
  createSessionService,
  type RefreshTokenRecord,
  type RefreshTokenStore,
  type RefreshTokenTx,
} from '../../src/modules/auth/sessions.js';

/** In-memory store with the same semantics as the Prisma one. */
function memoryStore() {
  const rows = new Map<string, RefreshTokenRecord>();
  const tx: RefreshTokenTx = {
    findByHashForUpdate: async (h) => [...rows.values()].find((r) => r.tokenHash === h) ?? null,
    create: async (t) => {
      rows.set(t.id, { ...t, replacedBy: null, revokedAt: null });
    },
    markRotated: async (id, replacedBy, at) => {
      const r = rows.get(id)!;
      rows.set(id, { ...r, replacedBy, revokedAt: at });
    },
    revokeFamily: async (familyId, at) => {
      for (const r of rows.values()) if (r.familyId === familyId && !r.revokedAt) r.revokedAt = at;
    },
  };
  const store: RefreshTokenStore = {
    transaction: (fn) => fn(tx),
    create: tx.create,
    revokeFamily: tx.revokeFamily,
    findByHash: tx.findByHashForUpdate,
    async revokeAllForUser(userId, at, except) {
      const fams = new Set<string>();
      for (const r of rows.values()) {
        if (r.userId === userId && !r.revokedAt && r.familyId !== except) {
          r.revokedAt = at;
          fams.add(r.familyId);
        }
      }
      return [...fams];
    },
    listLive: async (userId, at) =>
      [...rows.values()].filter((r) => r.userId === userId && !r.revokedAt && r.expiresAt > at),
    familyStarts: async (ids) => {
      const m = new Map<string, Date>();
      for (const r of rows.values()) {
        if (!ids.includes(r.familyId)) continue;
        const cur = m.get(r.familyId);
        if (!cur || r.createdAt < cur) m.set(r.familyId, r.createdAt);
      }
      return m;
    },
  };
  return { store, rows };
}

const USER = '0192f7a1-0000-7000-8000-00000000000a';
let clock: number;
let mem: ReturnType<typeof memoryStore>;
let reuses: { userId: string; familyId: string }[];

function service(grace = 10) {
  return createSessionService({
    store: mem.store,
    ttlDays: 30,
    reuseGraceSec: grace,
    now: () => new Date(clock),
    onReuse: (i) => reuses.push(i),
  });
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

beforeEach(() => {
  clock = Date.UTC(2026, 9, 25, 12);
  mem = memoryStore();
  reuses = [];
});

describe('refresh tokens (SECURITY A4)', () => {
  it('issues 256-bit opaque tokens and stores only their SHA-256', async () => {
    const s = await service().start(USER, { userAgent: 'test' });
    expect(Buffer.from(s.raw, 'base64url')).toHaveLength(32);
    const [row] = [...mem.rows.values()];
    expect(row?.tokenHash).toBe(sha256Hex(s.raw));
    expect(JSON.stringify([...mem.rows.values()])).not.toContain(s.raw);
    expect(row!.expiresAt.getTime() - clock).toBe(30 * 24 * 3600 * 1000);
  });

  it('rotates on every use, keeping the family (= session id)', async () => {
    const svc = service();
    const s1 = await svc.start(USER);
    clock += 60_000;
    const s2 = await svc.rotate(s1.raw);
    expect(s2.raw).not.toBe(s1.raw);
    expect(s2.familyId).toBe(s1.familyId);
    clock += 60_000;
    const s3 = await svc.rotate(s2.raw);
    expect(s3.familyId).toBe(s1.familyId);
    expect(await svc.list(USER)).toHaveLength(1);
  });

  it('reuse of a rotated token (after the grace window) revokes the whole family', async () => {
    const svc = service();
    const s1 = await svc.start(USER);
    const s2 = await svc.rotate(s1.raw); // legit client rotates
    clock += 11_000;
    expect(await codeOf(svc.rotate(s1.raw))).toBe('UNAUTHENTICATED'); // attacker replays old one
    expect(reuses).toEqual([{ userId: USER, familyId: s1.familyId }]);
    // the legitimate holder's current token is dead too
    expect(await codeOf(svc.rotate(s2.raw))).toBe('UNAUTHENTICATED');
    expect(await svc.list(USER)).toHaveLength(0);
  });

  it('treats reuse within the grace window as a concurrent refresh (409, no revocation)', async () => {
    const svc = service(10);
    const s1 = await svc.start(USER);
    const s2 = await svc.rotate(s1.raw);
    clock += 2_000;
    expect(await codeOf(svc.rotate(s1.raw))).toBe('CONFLICT');
    expect(reuses).toEqual([]);
    expect(await codeOf(svc.rotate(s2.raw))).toBe('ok');
  });

  it('rejects unknown, expired and logged-out tokens', async () => {
    const svc = service();
    expect(await codeOf(svc.rotate('nope'))).toBe('UNAUTHENTICATED');
    const s = await svc.start(USER);
    clock += 31 * 24 * 3600 * 1000;
    expect(await codeOf(svc.rotate(s.raw))).toBe('UNAUTHENTICATED');

    clock = Date.UTC(2026, 9, 25, 12);
    const t = await svc.start(USER);
    await svc.revokeByToken(t.raw);
    expect(await codeOf(svc.rotate(t.raw))).toBe('UNAUTHENTICATED');
    expect(reuses).toEqual([]); // logout is not theft
  });

  it('revokes all sessions except the current one', async () => {
    const svc = service();
    const a = await svc.start(USER);
    const b = await svc.start(USER);
    const c = await svc.start(USER);
    const revoked = await svc.revokeAllForUser(USER, a.familyId);
    expect(revoked.sort()).toEqual([b.familyId, c.familyId].sort());
    expect((await svc.list(USER)).map((x) => x.familyId)).toEqual([a.familyId]);
  });
});
