import { z } from 'zod';
import { EmailSchema, PASSWORD_MAX, PasswordSchema } from './auth.js';

/** Account deletion (AUTH-8, UF-14) and the email flows (AUTH-7, SECURITY A9). */

/** What to do with a room the deleted user owns. */
export const OwnedRoomChoiceSchema = z.discriminatedUnion('action', [
  z.strictObject({ roomId: z.uuid(), action: z.literal('transfer'), toUserId: z.uuid() }),
  z.strictObject({ roomId: z.uuid(), action: z.literal('delete') }),
]);
export type OwnedRoomChoice = z.infer<typeof OwnedRoomChoiceSchema>;

export const DeleteMeBodySchema = z.strictObject({
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX * 4),
  confirm: z.literal('DELETE'),
  /** rooms without a choice fall back to the longest-standing editor, else soft delete */
  rooms: z.array(OwnedRoomChoiceSchema).max(100).default([]),
});
export type DeleteMeBody = z.input<typeof DeleteMeBodySchema>;

/** 32 random bytes, base64url (43 chars). */
const EmailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or expired link');

export const VerifyEmailBodySchema = z.strictObject({ token: EmailTokenSchema });
export const ForgotPasswordBodySchema = z.strictObject({ email: EmailSchema });
export const ResetPasswordBodySchema = z.strictObject({
  token: EmailTokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordBody = z.input<typeof ResetPasswordBodySchema>;

/** Email token lifetimes (SECURITY A9). */
export const EMAIL_TOKEN_TTL_MS = {
  verify: 24 * 60 * 60 * 1000,
  reset: 30 * 60 * 1000,
} as const;
export type EmailTokenPurpose = keyof typeof EMAIL_TOKEN_TTL_MS;

/** `GET /api/v1/config` — public feature flags the UI needs before login. */
export const PublicConfigResponseSchema = z.object({ emailEnabled: z.boolean() });
export type PublicConfig = z.infer<typeof PublicConfigResponseSchema>;
