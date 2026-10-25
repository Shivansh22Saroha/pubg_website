import type { ApiErrorDetail, ErrorCode } from '@rotationlab/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  ROOM_LOCKED: 403,
  WRONG_ROOM_PASSWORD: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  USERNAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  ALREADY_MEMBER: 409,
  INVITE_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  LIMIT_REACHED: 422,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** Throw from routes/services; the error handler turns it into the standard error body. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusForCode(code);
    this.details = details;
  }
}
