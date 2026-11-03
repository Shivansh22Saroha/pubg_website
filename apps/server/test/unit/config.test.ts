import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
  NODE_ENV: 'development',
  PORT: '4000',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://rl:pw@localhost:5432/rotationlab',
  REDIS_URL: 'redis://:pw@localhost:6379/0',
  JWT_SECRET: 'x'.repeat(48),
  JWT_ISSUER: 'rotationlab',
  JWT_AUDIENCE: 'rotationlab-web',
  COOKIE_SECURE: 'false',
  IP_HASH_SALT: 'y'.repeat(32),
  TRUST_PROXY: 'false',
};

describe('loadConfig', () => {
  it('parses a valid dev environment and applies defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.PORT).toBe(4000);
    expect(cfg.ACCESS_TOKEN_TTL_SEC).toBe(900);
    expect(cfg.MAX_ROOM_MEMBERS).toBe(16);
    expect(cfg.CORS_DEV_ORIGINS).toEqual(['http://localhost:3000']);
    expect(cfg.EMAIL_ENABLED).toBe(false);
  });

  it('parses "false" as false (no z.coerce.boolean pitfall)', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(loadConfig({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('rejects booleans that are not exactly true/false', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
  });

  it('refuses to start when a required variable is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/JWT_SECRET/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('requires secure cookies in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' }),
    ).not.toThrow();
  });

  it('does not echo secret values in the error message', () => {
    try {
      loadConfig({ ...base, JWT_SECRET: 'tiny-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('tiny-secret-value');
    }
  });
});

describe('thumbnail storage config (Phase 11)', () => {
  const s3 = {
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    S3_BUCKET: 'rotationlab-assets',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
    PUBLIC_ASSETS_BASE_URL: 'https://assets.example.com',
  };

  it('defaults to local disk; empty S3 values count as unset', () => {
    const cfg = loadConfig({ ...base, S3_ENDPOINT: '', S3_BUCKET: '' });
    expect(cfg.ASSETS_DIR).toBe('data/assets');
    expect(cfg.S3_ENDPOINT).toBeUndefined();
    expect(cfg.S3_REGION).toBe('auto');
  });

  it('accepts all five S3 values together', () => {
    expect(loadConfig({ ...base, ...s3 }).S3_BUCKET).toBe('rotationlab-assets');
  });

  it('refuses a partial S3 setup and names what is missing (never the values)', () => {
    const { S3_SECRET_ACCESS_KEY: _s, PUBLIC_ASSETS_BASE_URL: _p, ...partial } = s3;
    expect(() => loadConfig({ ...base, ...partial })).toThrow(
      /S3_SECRET_ACCESS_KEY[\s\S]*PUBLIC_ASSETS_BASE_URL|PUBLIC_ASSETS_BASE_URL[\s\S]*S3_SECRET_ACCESS_KEY/,
    );
    expect(() => loadConfig({ ...base, ...partial })).not.toThrow(/secret|\bid\b/);
    expect(() => loadConfig({ ...base, ...s3, S3_ENDPOINT: 'not a url' })).toThrow(/S3_ENDPOINT/);
  });
});
