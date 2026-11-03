# DEPLOYMENT — RotationLab

v1 target: **one Linux VM** running Docker Compose (Caddy, web, server, Postgres, Redis) + **Cloudflare R2** for tiles. Simple, cheap (a 2 vCPU / 4 GB VM; check current pricing — budget providers are much cheaper than the big clouds), and enough for the PRD's 500 concurrent users. Section 8 covers scaling out later.

## 1. Environments
| Env | URL | Deploys from | Data |
|---|---|---|---|
| Local | localhost:3000 | working tree | seed |
| Staging | staging.example.com | `main` branch (auto) | demo seed, reset weekly |
| Production | app.example.com | git tag `v*` (manual approval) | real |

## 2. Build artifacts
Two images pushed to GitHub Container Registry:
- `ghcr.io/<owner>/rotationlab-web:<sha|tag>`
- `ghcr.io/<owner>/rotationlab-server:<sha|tag>`

### `docker/web.Dockerfile` (Next.js standalone)
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_ORIGIN NEXT_PUBLIC_TILES_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=web...

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
```
(`output: 'standalone'` in `next.config.ts`. `NEXT_PUBLIC_*` values are baked at build time → build per environment, or use runtime config via an injected `window.__ENV`.)

### `docker/server.Dockerfile`
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter server prisma generate \
 && pnpm turbo run build --filter=server... \
 && pnpm --filter server deploy --prod /out

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
```

## 3. Production compose (`/opt/rotationlab/docker-compose.prod.yml`)
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web, server]
    restart: unless-stopped

  web:
    image: ghcr.io/<owner>/rotationlab-web:${TAG}
    env_file: .env.web
    restart: unless-stopped

  server:
    image: ghcr.io/<owner>/rotationlab-server:${TAG}
    env_file: .env.server
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]

  migrate:                       # one-shot, run before switching traffic
    image: ghcr.io/<owner>/rotationlab-server:${TAG}
    env_file: .env.server
    command: ["npx", "prisma", "migrate", "deploy"]
    profiles: ["migrate"]

  postgres:
    image: postgres:17-alpine
    env_file: .env.postgres
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready"], interval: 5s, retries: 10 }
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["sh", "-c", "redis-server --requirepass \"$$REDIS_PASSWORD\" --appendonly yes"]
    env_file: .env.redis
    volumes: [redisdata:/data]
    restart: unless-stopped

volumes: { pgdata: {}, redisdata: {}, caddy_data: {}, caddy_config: {} }
```
No `ports:` on postgres/redis/web/server — only Caddy is exposed.

### `Caddyfile`
```
app.example.com {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    -Server
  }
  @api path /api/* /realtime/*
  handle @api {
    reverse_proxy server:4000
  }
  @metrics path /metrics
  respond @metrics 404
  handle {
    reverse_proxy web:3000
  }
}
```
(CSP with per-request nonce is set by Next.js middleware, not Caddy.)

## 4. Map tiles deployment (one-time per tile version)
```bash
pnpm --filter map-tiles run fetch      # `fetch` alone is a built-in pnpm command
pnpm --filter map-tiles run build              # → packages/map-tiles/out/
rclone sync packages/map-tiles/out r2:rotationlab-tiles/v1 \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --transfers 32
```
R2 bucket settings: public custom domain `tiles.example.com`; CORS rule allowing `GET` from `https://app.example.com` (required for PNG export canvas). Set `NEXT_PUBLIC_TILES_BASE_URL=https://tiles.example.com/v1`. New tile build → upload to `/v2`, switch env, redeploy web.

Each map folder holds `preview.jpg` (1024 px, auth backdrop), `card.webp` (512 px, dashboard room cards — added after Phase 9) and `thumb.jpg` (256 px). A bucket synced before `card.webp` existed only needs the new files added (`rclone copy`); the web app shows the map name in place of a missing image.

**Tile CORS (required for Export PNG, FEATURES F12).** The web app loads every tile and the low-res placeholder with `crossOrigin="anonymous"`, so the browser sends an `Origin` header and needs an `Access-Control-Allow-Origin` back — otherwise the export canvas is tainted and `toBlob` throws (the UI says "Export blocked: the map tiles are not CORS-enabled"). R2 → bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

Add the staging origin to `AllowedOrigins` too. Keep the CDN cache keyed on `Origin` (R2's public bucket does this) so a non-CORS response is never served to the app. In development and E2E the tiles are same-origin (`/tiles`), so no rule is needed.

## 5. CI/CD (GitHub Actions)

### `.github/workflows/ci.yml` (on PR and push)
1. Checkout, setup Node 22, `corepack enable`, cache pnpm store.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint && pnpm typecheck`
4. `pnpm test` (unit)
5. Integration tests with services `postgres:17`, `redis:7` (or Testcontainers).
6. Build web + server.
7. Playwright E2E (Chromium) against `docker compose -f docker-compose.ci.yml up` with fixture tiles; upload traces on failure.
8. Security: `pnpm audit --prod --audit-level=high`, gitleaks, (nightly) ZAP baseline vs staging.

### `.github/workflows/deploy.yml`
- **On push to `main`** → build & push images tagged `sha-<short>` → SSH to staging VM → `TAG=sha-xxx docker compose --profile migrate run --rm migrate && docker compose up -d` → smoke test `curl https://staging.example.com/api/health`.
- **On tag `v*`** → same images re-tagged `vX.Y.Z` → **environment `production` with required reviewer** → deploy to prod VM → smoke test → on failure, automatic rollback to previous `TAG` (kept in `/opt/rotationlab/.last_tag`).
- Secrets used: `GHCR_TOKEN` (or `GITHUB_TOKEN`), `STAGING_SSH_KEY`, `PROD_SSH_KEY`, host/user vars. App secrets live on the VMs, not in Actions.

## 6. Server setup checklist (fresh VM, Ubuntu 24.04 LTS)
- [ ] Create non-root deploy user, SSH key auth only, disable password login & root SSH.
- [ ] `ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw enable`
- [ ] Install Docker Engine + compose plugin; add deploy user to `docker` group.
- [ ] `unattended-upgrades` enabled; `fail2ban` for SSH.
- [ ] DNS A/AAAA records for `app` and `staging`.
- [ ] `/opt/rotationlab/` with compose file, Caddyfile, `.env.*` files (chmod 600).
- [ ] First deploy: `docker compose --profile migrate run --rm migrate`, then `up -d`.
- [ ] Verify headers (securityheaders.com), TLS (SSL Labs A), websocket connect.

## 7. Operations
| Task | How |
|---|---|
| Backups | nightly cron: `docker exec postgres pg_dump -Fc` → encrypt with `age` → upload to R2 `backups/` bucket (separate credentials); retain 14 daily + 8 weekly; monthly restore test into staging |
| Logs | `docker compose logs`; ship to Better Stack/Grafana Loki optional; rotate with Docker `json-file` `max-size: 10m, max-file: 5` |
| Uptime | Uptime Kuma / Better Stack checking `/api/health` every 1 min, alerts to Discord webhook |
| Errors | Sentry projects for web & server, release = git tag |
| Migrations | always additive/expand-contract; never drop a column in the same release that stops using it |
| Zero-downtime-ish | `docker compose up -d --no-deps server` restarts server (~2 s); clients auto-reconnect and resync — acceptable for v1 |
| Maintenance mode | env `MAINTENANCE=true` → server returns 503 + web shows banner |

## 8. Scaling path (when needed)
1. Move Postgres to managed (Neon / RDS / Supabase Postgres) and Redis to managed (Upstash / ElastiCache).
2. Run 2+ `server` replicas behind Caddy/Load balancer — Socket.IO Redis adapter already in place; use websocket-only transport or sticky sessions.
3. Move element seq allocation to Redis `INCR` + batched write-behind if a single board becomes write-hot.
4. Separate realtime and REST into two deployments if CPU profiles diverge.

## Phase 9: public pages
- **Demo boards**: after the first deploy run `pnpm --filter server seed --demo-only` once against production (idempotent; it refuses to seed dev users there) and put the printed `DEMO_BOARD_IDS=` line into the server env. `/explore` shows bare maps until then.
- **Web env**: set `SECURITY_CONTACT` (otherwise `/.well-known/security.txt` is a 404) and leave `ENABLE_DEV_PAGES` unset (the `/maps/*` viewer stays a 404).
- **Landing screenshots** are committed WebP files in `apps/web/public/landing/`; regenerate them with `pnpm --filter web shots` against `pnpm dev` + the dev seed when the UI changes.
