import { Redis } from 'ioredis';

export function createRedis(url: string) {
  return new Redis(url, {
    lazyConnect: true,
    // resolve IPv4 and IPv6: Railway's private network (redis.railway.internal) is IPv6-only
    family: 0,
    maxRetriesPerRequest: 1,
    // keep retrying in the background so the server recovers when Redis comes back
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
}
