import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db/prisma.js';
import { startJobs } from './jobs/index.js';
import { createRedis } from './lib/redis.js';
import { initSentry } from './lib/sentry.js';

// boot: config → db → redis → fastify + Socket.IO (ARCHITECTURE §3) → jobs
const config = loadConfig();
initSentry(config);
const prisma = createPrisma(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

const app = await buildApp({ config, prisma, redis });
if (config.NODE_ENV === 'production' && app.assets.kind === 'local') {
  // the production container's root FS is read-only: thumbnails need R2 / S3 (DEPLOYMENT §4)
  app.log.warn(
    'S3_* not set: board thumbnails use local disk (ASSETS_DIR) and need a writable volume',
  );
}

redis.on('error', (err) => {
  app.log.warn({ err: err.message }, 'redis connection error');
});
redis.connect().catch(() => {
  // reported via health + the error listener; the retry strategy keeps reconnecting
});

const stopJobs = startJobs({ prisma, redis, log: app.log, assets: app.assets });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  stopJobs();
  await app.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
