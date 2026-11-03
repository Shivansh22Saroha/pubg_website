import { z } from 'zod';

/** Every error code the API may return (API_SPEC §1.4). */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'CSRF_FAILED',
  'ROOM_LOCKED',
  'WRONG_ROOM_PASSWORD',
  'NOT_FOUND',
  'CONFLICT',
  'USERNAME_TAKEN',
  'EMAIL_TAKEN',
  'ALREADY_MEMBER',
  'INVITE_EXPIRED',
  'PAYLOAD_TOO_LARGE',
  'LIMIT_REACHED',
  'ACCOUNT_LOCKED',
  'RATE_LIMITED',
  'INTERNAL',
  /** 503 while MAINTENANCE=true (DEPLOYMENT §7) */
  'MAINTENANCE',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorDetailSchema = z.object({
  path: z.string(),
  issue: z.string(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/** Uniform REST error body: `{ error: { code, message, details?, requestId } }`. */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(ApiErrorDetailSchema).optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
