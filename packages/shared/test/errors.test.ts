import { describe, expect, it } from 'vitest';
import { ApiErrorBodySchema, ERROR_CODES } from '../src/index.js';

describe('ApiErrorBodySchema', () => {
  it('accepts the documented error shape', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Name is too short',
        details: [{ path: 'name', issue: 'too_small' }],
        requestId: '0192f7a1-0000-7000-8000-000000000000',
      },
    };
    expect(ApiErrorBodySchema.parse(body)).toEqual(body);
  });

  it('rejects an unknown code', () => {
    const body = { error: { code: 'OOPS', message: 'x', requestId: 'r' } };
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(false);
  });

  it('lists every code from API_SPEC §1.4 exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toHaveLength(20);
  });
});
