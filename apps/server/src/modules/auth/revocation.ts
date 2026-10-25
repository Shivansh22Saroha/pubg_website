import type { Redis } from 'ioredis';

const key = (sid: string) => `rl:revoked-sid:${sid}`;

/**
 * Access JWTs live 15 min and are stateless. When a session is revoked (logout, logout-all,
 * password change, refresh-token theft) its sid is remembered for one access-token lifetime so
 * those JWTs stop working immediately instead of up to 15 min later.
 */
export function createRevocationList(redis: Redis, accessTtlSec: number) {
  return {
    async revoke(sids: string[]): Promise<void> {
      if (sids.length === 0) return;
      const pipe = redis.multi();
      for (const sid of sids) pipe.set(key(sid), '1', 'EX', accessTtlSec);
      await pipe.exec();
    },
    async isRevoked(sid: string): Promise<boolean> {
      return (await redis.exists(key(sid))) === 1;
    },
  };
}
export type RevocationList = ReturnType<typeof createRevocationList>;
