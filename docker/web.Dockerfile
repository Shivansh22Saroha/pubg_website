# syntax=docker/dockerfile:1
# Web image (DEPLOYMENT §2): Next.js standalone output. NEXT_PUBLIC_* values are inlined at
# build time, so this image is built once per environment (staging / production).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
ARG NEXT_PUBLIC_APP_ORIGIN
ARG NEXT_PUBLIC_TILES_BASE_URL
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN \
    NEXT_PUBLIC_TILES_BASE_URL=$NEXT_PUBLIC_TILES_BASE_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_PUBLIC_API_BASE=/api/v1 \
    NEXT_PUBLIC_SOCKET_PATH=/realtime \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile \
 && pnpm turbo run build --filter=web \
 && pnpm --filter web check:no-debug

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
