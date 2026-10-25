import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '../src/index.js';

describe('HealthResponseSchema', () => {
  it('accepts a healthy response', () => {
    const body = { status: 'ok', db: 'ok', redis: 'ok', version: '0.1.0' };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a degraded response', () => {
    const body = { status: 'degraded', db: 'error', redis: 'ok', version: '0.1.0' };
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    { status: 'fine', db: 'ok', redis: 'ok', version: '1' },
    { status: 'ok', db: 'down', redis: 'ok', version: '1' },
    { status: 'ok', db: 'ok', redis: 'ok' },
  ])('rejects %o', (body) => {
    expect(HealthResponseSchema.safeParse(body).success).toBe(false);
  });
});
