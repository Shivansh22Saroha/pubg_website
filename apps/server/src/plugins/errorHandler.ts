import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '@rotationlab/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ApiErrorDetail[],
) {
  const body: ApiErrorBody = {
    error: { code, message, ...(details ? { details } : {}), requestId: request.id },
  };
  return reply.status(status).send(body);
}

/** Maps every thrown error to the uniform API error shape (API_SPEC §1.4). */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return send(reply, request, err.statusCode, err.code, err.message, err.details);
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        issue: v.keyword, // the Zod issue code, e.g. "too_small"
      }));
      return send(reply, request, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
    }

    if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return send(reply, request, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (err.statusCode === 429) {
      return send(reply, request, 429, 'RATE_LIMITED', 'Too many requests');
    }
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      return send(reply, request, err.statusCode, 'BAD_REQUEST', 'Bad request');
    }

    // Unexpected: log the full error, return nothing internal to the client.
    request.log.error({ err }, 'unhandled error');
    return send(reply, request, 500, 'INTERNAL', 'Something went wrong');
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, 'NOT_FOUND', 'Route not found'),
  );
}
