# syntax=docker/dockerfile:1
# API image (DEPLOYMENT §2). One image runs the server, `prisma migrate deploy` and the
# demo-board seed, so it keeps the server's dev tooling (prisma CLI, tsx).
# Debian slim, not Alpine: Prisma's Rust engine on musl was CPU-bound at ~217 ops/s where glibc
# handled 400 ops/s at under half the CPU (Phase 10 k6, CHANGELOG). openssl lets Prisma pick its
# engine (generated in the build stage, loaded in the run stage).
FROM node:22-bookworm-slim AS base
RUN corepack enable \
 && apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm turbo run build --filter=server \
 && pnpm --filter server deploy --legacy /out \
 && cd /out && ./node_modules/.bin/prisma generate

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=4000
RUN groupadd -r app && useradd -r -g app app \
 && apt-get update && apt-get install -y --no-install-recommends openssl wget \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
