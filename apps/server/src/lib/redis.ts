import { Redis } from 'ioredis';

export function createRedis(url: string) {
  return new Redis(url, {
    lazyConnect: true,
    // resolve IPv4 and IPv6: some hosts' private networks are IPv6-only (e.g. Railway)
    family: 0,
    maxRetriesPerRequest: 1,
    // keep retrying in the background so the server recovers when Redis comes back
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
}
