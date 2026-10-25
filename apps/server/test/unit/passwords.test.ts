import { describe, expect, it } from 'vitest';
import { hexDigestEquals, sha256Hex } from '../../src/lib/crypto.js';
import { AppError } from '../../src/lib/errors.js';
import { breachedPasswords, isBreachedPassword } from '../../src/modules/auth/breached.js';
import { lockDurationMs } from '../../src/modules/auth/lockout.js';
import { assertPasswordPolicy, createPasswordHasher } from '../../src/modules/auth/passwords.js';

function policyIssue(pw: string): string | null {
  try {
    assertPasswordPolicy(pw);
    return null;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return e.details?.[0]?.issue ?? e.code;
  }
}

describe('password policy (SECURITY A2)', () => {
  it('accepts 10–128 characters with no composition rules', () => {
    expect(policyIssue('correct horse battery')).toBeNull();
    expect(policyIssue('qx7vn2kd9w')).toBeNull(); // exactly 10, lower-case only
    expect(policyIssue('z'.repeat(9) + 'ä')).toBeNull(); // counts code points
    expect(policyIssue('x'.repeat(128))).toBeNull();
  });

  it('rejects too short and too long', () => {
    expect(policyIssue('short9char')).toBeNull();
    expect(policyIssue('nine-char')).toBe('policy');
    expect(policyIssue('x'.repeat(129))).toBe('policy');
  });

  it('rejects breached passwords, case-insensitively', () => {
    expect(breachedPasswords().size).toBeGreaterThan(5000);
    expect(isBreachedPassword('1234567890')).toBe(true);
    expect(policyIssue('1234567890')).toBe('breached');
    expect(policyIssue('Password123')).toBe('breached');
    expect(policyIssue('PASSWORD123')).toBe('breached');
  });

  it('only bundles entries that could pass the length policy', () => {
    for (const p of breachedPasswords()) {
      expect(Array.from(p).length).toBeGreaterThanOrEqual(10);
      expect(p).toBe(p.toLowerCase());
    }
  });
});

describe('argon2id hasher (SECURITY A1)', () => {
  const hasher = createPasswordHasher({ memoryCost: 1024, timeCost: 1 });

  it('produces argon2id hashes that verify, and never contain the plaintext', async () => {
    const h = await hasher.hash('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).not.toContain('correct horse battery');
    expect(await hasher.verify(h, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(h, 'wrong horse battery')).toBe(false);
  });

  it('normalises to NFC so composed and decomposed input match', async () => {
    const h = await hasher.hash('café-password');
    expect(await hasher.verify(h, 'café-password')).toBe(true);
  });

  it('treats a malformed stored hash as a failed verify', async () => {
    expect(await hasher.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('runs a real argon2 verify for unknown users (dummy path) and returns false', async () => {
    expect(await hasher.dummyVerify('anything')).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('compares digests in constant time and rejects length mismatch', () => {
    const a = sha256Hex('x');
    expect(hexDigestEquals(a, sha256Hex('x'))).toBe(true);
    expect(hexDigestEquals(a, sha256Hex('y'))).toBe(false);
    expect(hexDigestEquals(a, a.slice(0, 62))).toBe(false);
    expect(hexDigestEquals('', '')).toBe(false);
  });
});

describe('lockout curve (SECURITY A6)', () => {
  it('locks 15 min, then doubles, capped at 24 h', () => {
    const min = 60_000;
    expect(lockDurationMs(1)).toBe(15 * min);
    expect(lockDurationMs(2)).toBe(30 * min);
    expect(lockDurationMs(3)).toBe(60 * min);
    expect(lockDurationMs(7)).toBe(16 * 60 * min);
    expect(lockDurationMs(8)).toBe(24 * 60 * min);
    expect(lockDurationMs(50)).toBe(24 * 60 * min);
  });
});
