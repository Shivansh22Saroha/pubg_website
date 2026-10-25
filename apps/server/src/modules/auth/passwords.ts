import { hash, verify } from '@node-rs/argon2';
import { PasswordSchema } from '@rotationlab/shared';
import { AppError } from '../../lib/errors.js';
import { isBreachedPassword } from './breached.js';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
}

/** Passwords are NFC-normalised before hashing so the same visible text always verifies. */
const normalize = (pw: string) => pw.normalize('NFC');

export function createPasswordHasher(params: Argon2Params) {
  // @node-rs/argon2 defaults to Argon2id (its Algorithm enum is an ambient const enum we can't
  // reference under verbatimModuleSyntax); the unit test asserts the `$argon2id$` prefix.
  const options = { parallelism: 1, ...params };
  let dummy: Promise<string> | undefined;

  return {
    hash: (password: string) => hash(normalize(password), options),

    async verify(passwordHash: string, password: string): Promise<boolean> {
      try {
        return await verify(passwordHash, normalize(password));
      } catch {
        return false;
      }
    },

    /** Same cost as a real verify, for unknown users (SECURITY A7: no timing-based enumeration). */
    async dummyVerify(password: string): Promise<false> {
      dummy ??= hash('rotationlab-dummy-password', options);
      await verify(await dummy, normalize(password)).catch(() => false);
      return false;
    },
  };
}
export type PasswordHasher = ReturnType<typeof createPasswordHasher>;

/** SECURITY A2: 10–128 chars, no composition rules, not a known-breached password. */
export function assertPasswordPolicy(password: string, field = 'password'): void {
  const parsed = PasswordSchema.safeParse(password);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid password', [
      { path: field, issue: 'policy' },
    ]);
  }
  if (isBreachedPassword(password)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'This password appears in lists of breached passwords. Choose another one.',
      [{ path: field, issue: 'breached' }],
    );
  }
}
