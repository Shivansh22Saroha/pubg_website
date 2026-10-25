import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Integration tests run against the docker-compose Postgres/Redis (CI: service containers).
 * URLs come from TEST_DATABASE_URL / TEST_REDIS_URL, else are derived from apps/server/.env
 * (database `rotationlab_test`, Redis DB 15) so dev data is never touched.
 */
export default async function setup(project: TestProject) {
  if (!process.env.DATABASE_URL && existsSync(`${SERVER_DIR}.env`)) {
    process.loadEnvFile(`${SERVER_DIR}.env`);
  }
  const devDb = process.env.DATABASE_URL;
  const devRedis = process.env.REDIS_URL;
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? (devDb ? withDb(devDb, 'rotationlab_test') : undefined);
  const redisUrl = process.env.TEST_REDIS_URL ?? (devRedis ? withDb(devRedis, '15') : undefined);
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Integration tests need Postgres + Redis: run `docker compose up -d postgres redis` and create apps/server/.env, or set TEST_DATABASE_URL / TEST_REDIS_URL.',
    );
  }

  // create the test database if needed (connect to the maintenance db)
  const admin = new PrismaClient({ datasourceUrl: withDb(databaseUrl, 'postgres') });
  const name = new URL(databaseUrl).pathname.slice(1);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replaceAll('"', '')}"`);
  } catch (err) {
    if (!String(err).includes('already exists')) throw err;
  } finally {
    await admin.$disconnect();
  }

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redisUrl);
}
