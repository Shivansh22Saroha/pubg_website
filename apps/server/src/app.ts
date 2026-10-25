import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';

export interface AppDeps {
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL' | 'TRUST_PROXY'>;
  checks: HealthChecks;
}

// SECURITY §7: never log credentials or cookies.
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
];

function loggerOptions(config: AppDeps['config']): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  };
}

export async function buildApp({ config, checks }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 100 * 1024, // SECURITY §6: REST bodies ≤ 100 KB
    genReqId: () => randomUUID(),
    requestIdHeader: false, // never trust a client-supplied request id
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(healthRoutes, { checks });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
