import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { escapeHtml } from '../../src/lib/mailer.js';
import { resetPasswordMail, verifyEmailMail } from '../../src/modules/auth/emails.js';
import { createEmailTokens, hashEmailToken } from '../../src/modules/auth/emailTokens.js';
import { autoName } from '../../src/modules/snapshots/capture.js';
import {
  anonymousUsername,
  resolveOwnedRooms,
  type OwnedRoom,
} from '../../src/modules/users/account.js';

const ME = '0192f7a1-0000-7000-8000-0000000000aa';
const A = '0192f7a1-0000-7000-8000-00000000000a';
const B = '0192f7a1-0000-7000-8000-00000000000b';
const C = '0192f7a1-0000-7000-8000-00000000000c';
const d = (s: string) => new Date(s);

describe('account deletion: ownership resolution (AUTH-8)', () => {
  const room = (id: string, members: OwnedRoom['members']): OwnedRoom => ({ id, members });
  const r1 = room('r1', [
    { userId: ME, role: 'OWNER', joinedAt: d('2026-01-01') },
    { userId: A, role: 'VIEWER', joinedAt: d('2026-01-02') },
    { userId: B, role: 'EDITOR', joinedAt: d('2026-03-01') },
    { userId: C, role: 'EDITOR', joinedAt: d('2026-02-01') },
  ]);
  const r2 = room('r2', [
    { userId: ME, role: 'OWNER', joinedAt: d('2026-01-01') },
    { userId: A, role: 'VIEWER', joinedAt: d('2026-01-02') },
  ]);

  it('explicit choices win: transfer to any member (viewers too), or delete', () => {
    expect(
      resolveOwnedRooms(
        ME,
        [r1, r2],
        [
          { roomId: 'r1', action: 'transfer', toUserId: A },
          { roomId: 'r2', action: 'delete' },
        ],
      ),
    ).toEqual([
      { roomId: 'r1', action: 'transfer', toUserId: A, fallback: false },
      { roomId: 'r2', action: 'delete', fallback: false },
    ]);
  });

  it('no choice: the longest-standing editor (never a viewer), else soft delete', () => {
    expect(resolveOwnedRooms(ME, [r1, r2], [])).toEqual([
      { roomId: 'r1', action: 'transfer', toUserId: C, fallback: true },
      { roomId: 'r2', action: 'delete', fallback: true },
    ]);
  });

  it('rejects: a room I don’t own, two choices for one room, a non-member or myself as target', () => {
    const bad = (choices: Parameters<typeof resolveOwnedRooms>[2]) => () =>
      resolveOwnedRooms(ME, [r1], choices);
    expect(bad([{ roomId: 'elsewhere', action: 'delete' }])).toThrow(AppError);
    expect(
      bad([
        { roomId: 'r1', action: 'delete' },
        { roomId: 'r1', action: 'delete' },
      ]),
    ).toThrow(/One choice per room/);
    expect(
      bad([{ roomId: 'r1', action: 'transfer', toUserId: '0192f7a1-0000-7000-8000-0000000000ff' }]),
    ).toThrow(/must be a member/);
    expect(bad([{ roomId: 'r1', action: 'transfer', toUserId: ME }])).toThrow(/must be a member/);
  });

  it('anonymous usernames fit the username pattern', () => {
    const u = anonymousUsername('0192f7a1-1234-7abc-8def-0123456789ab');
    expect(u).toBe('deleted_0123456789ab');
    expect(u).toMatch(/^[a-z0-9_]{3,20}$/);
  });
});

/** A tiny in-memory stand-in for the two Prisma calls the token service makes. */
function fakePrisma() {
  interface Row {
    id: string;
    userId: string;
    purpose: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  }
  const rows: Row[] = [];
  const matches = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const val = r[k as keyof Row];
      if (v && typeof v === 'object' && 'gt' in v) return (val as Date) > (v as { gt: Date }).gt;
      return val === v;
    });
  const emailToken = {
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return Promise.resolve({ count: hit.length });
    },
    create: ({ data }: { data: Omit<Row, 'usedAt'> }) => {
      rows.push({ ...data, usedAt: null });
      return Promise.resolve(data);
    },
    findUniqueOrThrow: ({ where }: { where: { tokenHash: string } }) => {
      const r = rows.find((x) => x.tokenHash === where.tokenHash);
      return r ? Promise.resolve(r) : Promise.reject(new Error('not found'));
    },
  };
  const prisma = { emailToken, $transaction: (ps: Promise<unknown>[]) => Promise.all(ps) };
  return { rows, prisma: prisma as unknown as PrismaClient };
}

describe('email token lifecycle (SECURITY A9)', () => {
  it('256-bit base64url, stored hashed, single use; verify lasts 24 h, reset 30 min', async () => {
    let now = new Date('2026-10-26T10:00:00Z');
    const { rows, prisma } = fakePrisma();
    const tokens = createEmailTokens(prisma, () => now);
    const raw = await tokens.issue(ME, 'verify');
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes
    expect(rows[0]?.tokenHash).toBe(hashEmailToken(raw));
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows[0]!.expiresAt.getTime() - now.getTime()).toBe(24 * 3600_000);

    await expect(tokens.consume(raw, 'reset')).rejects.toThrow('invalid or has expired'); // wrong purpose
    expect(await tokens.consume(raw, 'verify')).toBe(ME);
    await expect(tokens.consume(raw, 'verify')).rejects.toThrow('invalid or has expired'); // reused

    const reset = await tokens.issue(ME, 'reset');
    expect(rows.at(-1)!.expiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
    now = new Date(now.getTime() + 31 * 60_000);
    await expect(tokens.consume(reset, 'reset')).rejects.toThrow('invalid or has expired'); // expired
    await expect(tokens.consume('x'.repeat(43), 'reset')).rejects.toThrow('invalid or has expired');
  });

  it('a new token voids the earlier unused ones of that purpose only', async () => {
    const { prisma } = fakePrisma();
    const tokens = createEmailTokens(prisma);
    const v = await tokens.issue(ME, 'verify');
    const r1 = await tokens.issue(ME, 'reset');
    const r2 = await tokens.issue(ME, 'reset');
    await expect(tokens.consume(r1, 'reset')).rejects.toThrow();
    expect(await tokens.consume(r2, 'reset')).toBe(ME);
    expect(await tokens.consume(v, 'verify')).toBe(ME);
  });
});

describe('emails', () => {
  it('escape the display name in HTML; plain text carries the link', () => {
    const mail = verifyEmailMail(
      'a@example.com',
      '<img src=x onerror=alert(1)>',
      'https://app.example/verify-email?token=abc',
    );
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.text).toContain('https://app.example/verify-email?token=abc');
    expect(
      resetPasswordMail('a@example.com', 'Ana', 'https://x/reset-password?token=t').subject,
    ).toMatch(/Reset/);
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });
});

describe('auto snapshot names', () => {
  it('fit 60 characters, the original name shortened with an ellipsis', () => {
    expect(autoName('Before restore of ', 'Plan A')).toBe("Before restore of 'Plan A'");
    const long = autoName('Before restore of ', 'x'.repeat(60));
    expect(Array.from(long).length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…'")).toBe(true);
  });
});
