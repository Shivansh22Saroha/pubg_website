import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db/prisma.js';
import { createRedis } from './lib/redis.js';

// boot: config → db → redis → fastify (ARCHITECTURE §3). Socket.IO joins in Phase 5.
const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

const app = await buildApp({ config, prisma, redis });

redis.on('error', (err) => {
  app.log.warn({ err: err.message }, 'redis connection error');
});
redis.connect().catch(() => {
  // reported via health + the error listener; the retry strategy keeps reconnecting
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
