import { z } from 'zod';
import { DemoBoardSchema } from './public.js';

/**
 * Phase 11 — public read-only share links (FEATURES F4b, API_SPEC §5b). A link is a random
 * 128-bit token (base64url, 22 chars); the server stores only its SHA-256, so the full URL is
 * returned once — on create / regenerate — and never again.
 */
export const SHARE_TOKEN_BYTES = 16;
export const ShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const SHARE_EXPIRY = ['24h', '7d', '30d', 'never'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRY)[number];

export const CreateShareLinkBodySchema = z.strictObject({ expiresIn: z.enum(SHARE_EXPIRY) });
export type CreateShareLinkBody = z.input<typeof CreateShareLinkBodySchema>;

/** What a member sees about the board's link — never the token. */
export const ShareLinkSchema = z.object({
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const ShareLinkStatusResponseSchema = z.object({ share: ShareLinkSchema.nullable() });
/** create / regenerate: the only response that carries the URL */
export const ShareLinkCreatedResponseSchema = z.object({
  share: ShareLinkSchema,
  url: z.string(),
});
export type ShareLinkCreatedResponse = z.infer<typeof ShareLinkCreatedResponseSchema>;

export const ShareTokenParamsSchema = z.strictObject({ token: ShareTokenSchema });

/**
 * `GET /public/share/:token` — the board as it is now, read-only. Same shape as a demo board:
 * no room id, no author ids, nothing that names a member.
 */
export const SharedBoardResponseSchema = DemoBoardSchema.extend({
  expiresAt: z.iso.datetime().nullable(),
});
export type SharedBoardResponse = z.infer<typeof SharedBoardResponseSchema>;

/** `/s/<token>` on the app origin */
export function shareUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/$/, '')}/s/${token}`;
}
