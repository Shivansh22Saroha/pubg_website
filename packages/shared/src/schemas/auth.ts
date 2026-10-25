import { z } from 'zod';
import { codePointLength, HexColorSchema, textField } from '../text.js';

/** Cookie names (API_SPEC §1.1). With COOKIE_SECURE the server adds `__Host-` / `__Secure-`. */
export const AUTH_COOKIES = {
  access: 'rl_at',
  refresh: 'rl_rt',
  accessSecure: '__Host-rl_at',
  refreshSecure: '__Secure-rl_rt',
} as const;

/** Header every mutating request must carry (API_SPEC §1.2). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'rotationlab';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, '3–20 characters: a–z, 0–9 and _');

export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

const codePoints = codePointLength;

/** Length policy only; the breached-list check runs on the server (SECURITY A2). */
export const PasswordSchema = z
  .string()
  .refine((v) => codePoints(v) >= PASSWORD_MIN, {
    message: `At least ${PASSWORD_MIN} characters`,
  })
  .refine((v) => codePoints(v) <= PASSWORD_MAX, {
    message: `At most ${PASSWORD_MAX} characters`,
  });

export const DisplayNameSchema = textField(1, 32);
export const IgnSchema = textField(1, 32);

// ---- request bodies -------------------------------------------------------------------

export const RegisterBodySchema = z.strictObject({
  email: EmailSchema,
  username: UsernameSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema.optional(),
});
export type RegisterBody = z.input<typeof RegisterBodySchema>;

export const LoginBodySchema = z.strictObject({
  /** email or username */
  identifier: z.string().trim().min(1).max(254),
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX * 4), // never echo policy on login
});
export type LoginBody = z.input<typeof LoginBodySchema>;

export const UsernameAvailableQuerySchema = z.strictObject({ u: z.string().max(64) });
export const UsernameAvailableResponseSchema = z.object({ available: z.boolean() });
export type UsernameAvailableResponse = z.infer<typeof UsernameAvailableResponseSchema>;

// ---- users ----------------------------------------------------------------------------

export const PublicUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  ign: z.string().nullable(),
  avatarColor: HexColorSchema,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const MeSchema = PublicUserSchema.extend({
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Me = z.infer<typeof MeSchema>;

export const UserResponseSchema = z.object({ user: MeSchema });
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const UpdateMeBodySchema = z
  .strictObject({
    displayName: DisplayNameSchema.optional(),
    ign: IgnSchema.nullable().optional(),
    avatarColor: HexColorSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateMeBody = z.input<typeof UpdateMeBodySchema>;

export const ChangePasswordBodySchema = z.strictObject({
  currentPassword: z
    .string()
    .min(1)
    .max(PASSWORD_MAX * 4),
  newPassword: PasswordSchema,
});
export type ChangePasswordBody = z.input<typeof ChangePasswordBodySchema>;

export const SessionSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;
export const SessionsResponseSchema = z.object({ items: z.array(SessionSchema) });

export const SessionIdParamsSchema = z.strictObject({ id: z.uuid() });

// ---- client-side helpers (rules list + strength meter, UI_UX_SPEC §3.2) ---------------

export interface PasswordRule {
  id: 'min' | 'max';
  label: string;
  ok: boolean;
}

export function passwordRules(pw: string): PasswordRule[] {
  const n = codePoints(pw);
  return [
    { id: 'min', label: `At least ${PASSWORD_MIN} characters`, ok: n >= PASSWORD_MIN },
    { id: 'max', label: `At most ${PASSWORD_MAX} characters`, ok: n <= PASSWORD_MAX },
  ];
}

/**
 * Rough 0–4 strength estimate for the meter only (no composition rules are enforced —
 * SECURITY A2). Length dominates; character variety and repetition adjust it.
 */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  const n = codePoints(pw);
  if (n === 0) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const unique = new Set(pw).size;
  let score = n >= 16 ? 3 : n >= 12 ? 2 : n >= PASSWORD_MIN ? 1 : 0;
  if (classes >= 3) score += 1;
  if (unique < n / 3) score -= 1;
  return Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
}
