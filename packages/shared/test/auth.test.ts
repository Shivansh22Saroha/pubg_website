import { describe, expect, it } from 'vitest';
import {
  cleanText,
  LoginBodySchema,
  passwordRules,
  passwordStrength,
  RegisterBodySchema,
  UpdateMeBodySchema,
} from '../src/index.js';

const valid = {
  email: 'Alice@Example.com ',
  username: ' Alice_1',
  password: 'correct horse battery',
};

describe('RegisterBodySchema', () => {
  it('normalises email and username to lower case', () => {
    expect(RegisterBodySchema.parse(valid)).toMatchObject({
      email: 'alice@example.com',
      username: 'alice_1',
    });
  });

  it.each([
    ['username too short', { username: 'ab' }],
    ['username too long', { username: 'a'.repeat(21) }],
    ['username with space', { username: 'a b c' }],
    ['username with dash', { username: 'a-b-c' }],
    ['bad email', { email: 'nope' }],
    ['email too long', { email: `${'a'.repeat(250)}@x.io` }],
    ['password 9 chars', { password: '123456789' }],
    ['password 129 chars', { password: 'x'.repeat(129) }],
    ['unknown key', { isAdmin: true }],
  ])('rejects %s', (_, patch) => {
    expect(RegisterBodySchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('cleans displayName and bounds it to 1–32 code points', () => {
    expect(RegisterBodySchema.parse({ ...valid, displayName: ' Rudra\u0000 ' }).displayName).toBe(
      'Rudra',
    );
    expect(RegisterBodySchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ ...valid, displayName: 'x'.repeat(33) }).success).toBe(
      false,
    );
  });
});

describe('LoginBodySchema / UpdateMeBodySchema', () => {
  it('requires identifier and password, nothing else', () => {
    expect(LoginBodySchema.safeParse({ identifier: 'alice', password: 'x' }).success).toBe(true);
    expect(LoginBodySchema.safeParse({ identifier: '', password: 'x' }).success).toBe(false);
    expect(
      LoginBodySchema.safeParse({ identifier: 'a', password: 'x', remember: true }).success,
    ).toBe(false);
  });

  it('validates colours and requires at least one field', () => {
    expect(UpdateMeBodySchema.safeParse({ avatarColor: '#38bdf8' }).success).toBe(true);
    expect(UpdateMeBodySchema.safeParse({ avatarColor: 'red' }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ avatarColor: '#38bdf8;x' }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ ign: null }).success).toBe(true);
  });
});

describe('cleanText (SECURITY V3)', () => {
  it('NFC-normalises, strips control chars and trims', () => {
    expect(cleanText('  café\u0007\n ')).toBe('café');
    expect(cleanText('line1\nline2', { keepNewlines: true })).toBe('line1\nline2');
    expect(cleanText('a​b')).toBe('a​b'); // zero-width is not a control char
  });
});

describe('password helpers (UI)', () => {
  it('reports the length rules', () => {
    expect(passwordRules('short').map((r) => r.ok)).toEqual([false, true]);
    expect(passwordRules('long enough pass').map((r) => r.ok)).toEqual([true, true]);
  });

  it('scores longer and more varied passwords higher', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('aaaaaaaaaa')).toBe(0);
    expect(passwordStrength('abcdefghij')).toBe(1);
    expect(passwordStrength('correct horse battery')).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('Tr0ub4dor&3-long-one')).toBe(4);
  });
});
