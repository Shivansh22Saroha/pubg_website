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
- `ghcr.io/<owner>/rotationlab-web:<sha-xxxxxxx|vX.Y.Z>`
- `ghcr.io/<owner>/rotationlab-server:<sha-xxxxxxx|vX.Y.Z>`

The real files (Phase 10) are `docker/web.Dockerfile`, `docker/server.Dockerfile` and `.dockerignore` (tiles, caches, env files and docs never enter the build context).

- **web** — `node:22-alpine`, Next.js standalone output, non-root, `HEALTHCHECK` on `/`. `NEXT_PUBLIC_*` (origin, tiles URL, Sentry DSN / environment) are build args inlined at build time, so the web image is **built per environment**; the build also runs `check:no-debug`.
- **server** — `node:22-bookworm-slim` (not Alpine: Prisma's engine on musl was CPU-bound at ≈ 217 ops/s where glibc handled 400 ops/s at under half the CPU — CHANGELOG Phase 10). `pnpm deploy` of the server package **with** its dev tooling, so the same image runs the API, `prisma migrate deploy` and the demo / load-test seeds (`tsx`). The Prisma engine is generated in the build stage with `openssl` present. Environment-agnostic: production re-tags the image staging ran.

## 3. Production compose — `deploy/`
Everything a VM needs lives in `deploy/` and is copied to `/opt/rotationlab/` by the deploy job:

| File | What |
|---|---|
| `docker-compose.prod.yml` | caddy, web, server, `migrate` (profile), postgres 17, redis 7. Only Caddy publishes ports. `web` / `server` run `read_only` with tmpfs; json-file logs capped at 10 MB × 5. Images: `${REGISTRY}rotationlab-*:${TAG}` |
| `Caddyfile` | `{$APP_DOMAIN}`: zstd/gzip; HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, no `Server`; deny-all CSP only for responses without one; 1 MB request cap; `/api/*` + `/realtime/*` → server, everything else → web. `/metrics` is never routed |
| `env/*.env.example` | templates for `env/{server,web,postgres,redis}.env` (git-ignored, mode 600 on the VM) |
| `deploy.sh` | `./deploy.sh <tag>`: pull → `migrate` → `up -d` → smoke test (both containers healthy, `/api/health` ok through Caddy, `/login` renders) → on failure **roll back** to `.last_tag` and exit 1 |
| `backup.sh` / `restore.sh` | §7 |
| `ci-ssh-deploy.sh` | used by the deploy workflow: scp the files above, `docker login ghcr.io` with the job token (piped), run `deploy.sh` |

`/opt/rotationlab/.env` (not in git) sets `REGISTRY=ghcr.io/<owner>/`, `APP_DOMAIN`, `ACME_EMAIL`, `AGE_RECIPIENT`, `RCLONE_REMOTE`.

(CSP with per-request nonce is set by the Next.js proxy, not Caddy — SECURITY §5.)

## 4. Map tiles deployment (one-time per tile version)
```bash
pnpm --filter map-tiles run fetch      # `fetch` alone is a built-in pnpm command
pnpm --filter map-tiles run build              # → packages/map-tiles/out/
rclone sync packages/map-tiles/out r2:rotationlab-tiles/v1 \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --transfers 32
```
R2 bucket settings: public custom domain `tiles.example.com`; CORS rule allowing `GET` from `https://app.example.com` (required for PNG export canvas). Set `NEXT_PUBLIC_TILES_BASE_URL=https://tiles.example.com/v1`. New tile build → upload to `/v2`, switch env, redeploy web.

Phase 12: `out/icons/items/*.webp` (the loot marker icons) syncs with the tiles — same bucket, same CORS rule (Export PNG draws them), immutable cache. A bucket synced before Phase 12 needs a re-run of `fetch` + `build` and `rclone copy out/icons r2:rotationlab-tiles/v1/icons`; without them loot markers show a crate glyph.

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

**Board thumbnails (Phase 11).** A second R2 bucket `rotationlab-assets` with a public custom domain (`assets.example.com`) and an API token scoped to Object Read & Write on it. Set the five `S3_*` / `PUBLIC_ASSETS_BASE_URL` values on the server and `PUBLIC_ASSETS_BASE_URL` on the web container (CSP). Objects are written as `thumbnails/<boardId>/<random>.jpg` with `Cache-Control: public, max-age=31536000, immutable` (a new key per upload) and deleted when replaced, when the board is deleted and when its room is purged. No CORS rule is needed (plain `<img>`, never read back into a canvas). Without S3 the server falls back to `ASSETS_DIR` on local disk, which the read-only production container can't write — it logs a warning at boot.

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

Implemented (Phase 10): the existing `check` and `fresh-clone-boot` jobs, plus `security` (audit — accepted advisories in `pnpm.auditConfig`, SECURITY §9 — and gitleaks 8.30 over the full history) and `images` (both Dockerfiles must build; GHA layer cache). E2E runs a production build against its own API, not a compose stack. `.github/workflows/zap.yml`: nightly ZAP baseline against `vars.STAGING_URL` (skipped while unset), fails on any High, uploads the HTML report.

### `.github/workflows/deploy.yml`
- **After a green CI run on `main`** (`workflow_run`) → build & push `sha-<short>` images (web with the staging build args) → `deploy/ci-ssh-deploy.sh` → `deploy.sh sha-<short>` on the staging VM (migrate, up, smoke test, rollback) → public `curl $STAGING_URL/api/health`.
- **On tag `v*`** → **environment `production` with required reviewer** → the server image of that commit re-tagged `vX.Y.Z` (`imagetools create`; built if it never was) and the web image built with the production build args → `deploy.sh vX.Y.Z` on the prod VM → smoke test → on failure, automatic rollback to the previous tag (`/opt/rotationlab/.last_tag`).
- Repo variables: `STAGING_HOST/USER/URL/TILES_BASE_URL`, `PROD_HOST/USER/URL/TILES_BASE_URL`, optional `WEB_SENTRY_DSN`. Secrets: `STAGING_SSH_KEY`, `STAGING_KNOWN_HOSTS`, `PROD_SSH_KEY`, `PROD_KNOWN_HOSTS`. GHCR uses the job's `GITHUB_TOKEN`. App secrets live on the VMs, not in Actions. Each job is skipped while its `*_HOST` variable is unset.
- Rollback is rehearsed (Phase 10, §9): a release whose server never turns healthy is detected and the previous tag restored. **Migrations are not rolled back** — they must stay additive (§7).

## 6. Server setup checklist (fresh VM, Ubuntu 24.04 LTS)
- [ ] Create non-root deploy user, SSH key auth only, disable password login & root SSH.
- [ ] `ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw enable`
- [ ] Install Docker Engine + compose plugin; add deploy user to `docker` group.
- [ ] `unattended-upgrades` enabled; `fail2ban` for SSH.
- [ ] DNS A/AAAA records for `app` and `staging`.
- [ ] `apt install age rclone`; `rclone config` an R2 remote with **backup-only** credentials.
- [ ] `/opt/rotationlab/` with `env/*.env` from `deploy/env/*.env.example` (chmod 600) and `.env` (`REGISTRY`, `APP_DOMAIN`, `ACME_EMAIL`, `AGE_RECIPIENT`, `RCLONE_REMOTE`). The deploy job copies the compose file, Caddyfile and scripts.
- [ ] Backup key: `age-keygen -o rl-backup.key` **on your own machine**; put only the public key (`age1…`) in `.env`; keep the private key offline (password manager). Cron: `15 3 * * * cd /opt/rotationlab && ./backup.sh >> backups/backup.log 2>&1`.
- [ ] First deploy: run the deploy workflow (or `./deploy.sh <tag>`), then the demo seed (§ Phase 9) with `docker compose -f docker-compose.prod.yml run --rm --no-deps server ./node_modules/.bin/tsx scripts/seed.ts --demo-only`.
- [ ] Verify headers (securityheaders.com), TLS (SSL Labs A), websocket connect.

## 7. Operations
| Task | How |
|---|---|
| Backups | `deploy/backup.sh` nightly (cron, §6): `pg_dump -Fc` inside the postgres container piped straight into `age -r $AGE_RECIPIENT` (never unencrypted on disk) → `backups/` (3 days) → `rclone` to `$RCLONE_REMOTE/daily` (14 days) and, on Sundays, `/weekly` (8 weeks) |
| Restore test (monthly) | `AGE_IDENTITY=~/rl-backup.key ./restore.sh <file>`: restores into a scratch database, prints row counts, drops it. `--into rotationlab` restores over the live database (stop `server` first) |
| Logs | `docker compose logs`; ship to Better Stack/Grafana Loki optional; rotate with Docker `json-file` `max-size: 10m, max-file: 5` |
| Uptime | Uptime Kuma / Better Stack checking `/api/health` every 1 min, alerts to Discord webhook |
| Errors | Sentry projects for web & server, release = git tag |
| Migrations | always additive/expand-contract; never drop a column in the same release that stops using it |
| Zero-downtime-ish | `docker compose up -d --no-deps server` restarts server (~2 s); clients auto-reconnect and resync — acceptable for v1 |
| Maintenance mode | `MAINTENANCE=true` in `env/server.env` **and** `env/web.env`, then `docker compose up -d server web`: the API answers `503 MAINTENANCE` (health and metrics stay up, new sockets refused), every page shows a banner |
| Metrics | `docker compose exec server wget -qO- http://127.0.0.1:4000/metrics` (add `--header "Authorization: Bearer …"` when `METRICS_TOKEN` is set) |

## 8. Scaling path (when needed)
1. Move Postgres to managed (Neon / RDS / Supabase Postgres) and Redis to managed (Upstash / ElastiCache).
2. Run 2+ `server` replicas behind Caddy/Load balancer — Socket.IO Redis adapter already in place; use websocket-only transport or sticky sessions.
3. Move element seq allocation to Redis `INCR` + batched write-behind if a single board becomes write-hot.
4. Separate realtime and REST into two deployments if CPU profiles diverge.

## Phase 9: public pages
- **Demo boards**: after the first deploy run `pnpm --filter server seed --demo-only` once against production (idempotent; it refuses to seed dev users there) and put the printed `DEMO_BOARD_IDS=` line into the server env. `/explore` shows bare maps until then.
- **Web env**: set `SECURITY_CONTACT` (otherwise `/.well-known/security.txt` is a 404) and leave `ENABLE_DEV_PAGES` unset (the `/maps/*` viewer stays a 404).
- **Landing screenshots** are committed WebP files in `apps/web/public/landing/`; regenerate them with `pnpm --filter web shots` against `pnpm dev` + the dev seed when the UI changes.

## 9. Local rehearsal of the production stack (Phase 10)
Everything above was exercised on Docker Desktop with throwaway secrets, `APP_DOMAIN=localhost` (Caddy's internal CA) and a separate compose project so the dev stack's volumes are never touched:
```bash
docker build -f docker/server.Dockerfile -t rotationlab-server:local .
docker build -f docker/web.Dockerfile -t rotationlab-web:local   --build-arg NEXT_PUBLIC_APP_ORIGIN=https://localhost --build-arg NEXT_PUBLIC_TILES_BASE_URL=/tiles .
cd deploy   # env/*.env filled from the templates; .env: REGISTRY= APP_DOMAIN=localhost
COMPOSE_PROJECT=rl-prodtest SKIP_PULL=1 CURL_INSECURE=1 ./deploy.sh local
```
Checked: headers and CSP per response type, `__Host-` / `__Secure-` cookies, `wss://…/realtime` through Caddy, zero CSP violations, rollback from a broken release, an encrypted backup restored into a scratch database, the demo seed from the image, ZAP baseline and the k6 load test (TESTING §7). Scanners on a dotless host send no SNI, which Caddy's internal-CA `localhost` policy rejects; serve a second name (`APP_DOMAIN="localhost, rl.localhost"`) and scan that.

## 10. Free deployment: Vercel + Render + Neon + GitHub Pages

The alternative to §3–§7 for running RotationLab at no cost on free URLs.

| Part | Host (free plan) | Why there |
|---|---|---|
| Web app (Next.js) | **Vercel** Hobby | built for Next.js |
| API + realtime (Fastify + Socket.IO) | **Render** free web service (`render.yaml`) | runs a long-lived Docker process with websockets; Vercel's serverless functions can't hold websockets |
| Redis | **Render** Key Value, free | same region as the API, internal network |
| Postgres | **Neon** free | doesn't expire (Render's free Postgres is deleted after 30 days) |
| Map tiles | **GitHub Pages** (repo `rotationlab-tiles`) | static files on a CDN, `Access-Control-Allow-Origin: *`, no card needed |

```
browser ──https──► <project>.vercel.app (Next.js on Vercel)
   │                    │  /api/*  ── rewrite (API_PROXY_URL) ──►┐
   │                                                              ▼
   └──wss + ticket──────────────────────────────► rotationlab-api.onrender.com (Fastify + Socket.IO)
                                                        ├─► Neon Postgres (TLS)
                                                        └─► Render Key Value (internal)
   tiles ◄── https://<user>.github.io/rotationlab-tiles/v1
```

How auth works across the two sites:
- **REST** goes through the Vercel rewrite. The browser only talks to `*.vercel.app`, so the `__Host-` cookies stay first-party there, and CSRF, `SameSite` and Origin checks work unchanged.
- **The websocket** connects straight to Render, because Vercel can't proxy websockets. Before every (re)connect the client fetches a 60 s single-use ticket from `POST /api/v1/auth/socket-ticket` over the rewrite, and passes it in the handshake (SECURITY A11). The handshake still checks `Origin` against `APP_ORIGIN`.

### 10.1 What "free" costs you
- **Render free web services sleep** after 15 minutes without traffic, and an open websocket counts as traffic. The next visitor waits about a minute while it wakes. Vercel waits up to two minutes for the API, so that first request is slow, not failed. 750 free instance hours a month cover one service running all month.
- **Render Key Value (free) is in memory only.** A restart drops presence, rate-limit counters, open socket tickets and the access-token revocation list; access tokens expire within 15 min anyway. Accounts, rooms and boards live in Postgres and are not affected.
- **Neon free:** 1 GB storage, 100 compute-hours a month; it sleeps after 5 minutes idle and wakes in under a second. Don't add an uptime pinger that hits `/api/health` every few minutes: it would keep Neon awake all month and use up its compute hours.
- **No shell on Render free:** one-off tasks (the demo seed) run from your own computer against Neon.
- **Thumbnails** go to the server's local disk, which resets on every deploy and sleep, so the dashboard falls back to the map image. **Email** stays off. Render free blocks outbound SMTP ports anyway.
- **Vercel Hobby** is for non-commercial use.

### 10.2 Map tiles → GitHub Pages
1. Create a public repo `rotationlab-tiles`.
2. Build the tiles (`pnpm --filter map-tiles run fetch && pnpm --filter map-tiles run build`). Copy `packages/map-tiles/out/` into the repo as `v1/` (so `v1/erangel/…`, `v1/icons/…`, `v1/manifest.json`). Add an empty `.nojekyll` file at the root, then commit and push.
3. Repo → **Settings → Pages → Source: Deploy from a branch → `main` / root**.
4. After a minute, `https://<user>.github.io/rotationlab-tiles/v1/erangel/preview.jpg` should open. That base, `https://<user>.github.io/rotationlab-tiles/v1`, is `NEXT_PUBLIC_TILES_BASE_URL`.

GitHub Pages sends `Access-Control-Allow-Origin: *`, so Export PNG works without any CORS setup. New tile build → push it as `v2/` and switch the env var.

### 10.3 Postgres → Neon
1. neon.com → sign up (GitHub login) → **New project**: Postgres 17, region **AWS Asia Pacific (Singapore)**, the same region as Render below.
2. **Connect** → turn **Connection pooling off** and copy the *direct* connection string (`postgresql://…neon.tech/neondb?sslmode=require`). Prisma migrations need the direct connection.

### 10.4 API + Redis → Render
1. render.com → sign up (GitHub login) → **New → Blueprint** → pick `pubg_website`. Render reads `render.yaml`: a free Docker web service `rotationlab-api` and a free Key Value `rotationlab-redis`, both in Singapore.
2. It asks for the two `sync: false` values:
   - `APP_ORIGIN` = `https://<your-project>.vercel.app` (pick the Vercel project name now; you can fix it later)
   - `DATABASE_URL` = the Neon direct string
   `JWT_SECRET` and `IP_HASH_SALT` are generated; `REDIS_URL` is wired to the Key Value.
3. **Apply**. The container runs `prisma migrate deploy` and then starts the API. The first build takes a few minutes. `https://rotationlab-api.onrender.com/api/health` should answer `{"status":"ok","db":"ok","redis":"ok",…}` (the URL is shown on the service page).

### 10.5 Web → Vercel
1. vercel.com → sign up (GitHub login) → **Add New → Project** → import `pubg_website`.
2. **Root Directory**: `apps/web` (framework: Next.js; Vercel installs from the monorepo root with pnpm).
3. **Build Command** (override): `cd ../.. && pnpm turbo run build --filter=web`. Turbo builds `@rotationlab/shared` first.
4. **Environment Variables**:
   ```
   NEXT_PUBLIC_APP_ORIGIN=https://<your-project>.vercel.app
   NEXT_PUBLIC_API_BASE=/api/v1
   NEXT_PUBLIC_SOCKET_PATH=/realtime
   NEXT_PUBLIC_SOCKET_URL=https://rotationlab-api.onrender.com
   NEXT_PUBLIC_TILES_BASE_URL=https://<user>.github.io/rotationlab-tiles/v1
   API_PROXY_URL=https://rotationlab-api.onrender.com
   INTERNAL_API_URL=https://rotationlab-api.onrender.com
   SECURITY_CONTACT=mailto:<you>@example.com
   ```
   `NEXT_PUBLIC_*` and `API_PROXY_URL` are baked in at build time: redeploy after changing them.
5. Project → **Settings → Functions → Region: Singapore (sin1)**. Server-side page renders then run next to the API instead of in the US.
6. Deploy. If the real domain differs from what you entered, set it in `NEXT_PUBLIC_APP_ORIGIN` (Vercel) and `APP_ORIGIN` (Render → service → Environment), then redeploy both. **Login fails until these match.**

### 10.6 Demo boards for `/explore` (optional)
From your computer, in the repo, with the Neon direct string:
```bash
# PowerShell: $env:DATABASE_URL="postgresql://…?sslmode=require"; $env:NODE_ENV="production"; pnpm --filter server seed --demo-only
DATABASE_URL="postgresql://…?sslmode=require" NODE_ENV=production pnpm --filter server seed --demo-only
```
Copy the printed `DEMO_BOARD_IDS=…` into Render → `rotationlab-api` → Environment (it redeploys). Until then `/explore` shows bare maps.

### 10.7 Check it
- [ ] The Vercel URL loads the landing page; register and log in work (the first request after a sleep can take about a minute).
- [ ] Create a room: the sync indicator shows **Synced** (websocket + ticket OK).
- [ ] A second browser joins with the invite link; drawings and chat appear live on both.
- [ ] All three maps show tiles (no 404s from `github.io` in the network tab); Export PNG works.

### 10.8 Notes
- **Previews:** Vercel preview deployments have other URLs than `APP_ORIGIN`, so login works only on the production URL.
- **Custom domain later:** add it in Vercel, then update `NEXT_PUBLIC_APP_ORIGIN` and `APP_ORIGIN`. Nothing else depends on the domains.
- **Outgrowing free:** Render's Starter plan removes the sleep; Railway runs the same Docker image (set `RAILWAY_DOCKERFILE_PATH=docker/server.Dockerfile`, the pre-deploy command `./node_modules/.bin/prisma migrate deploy` and healthcheck `/api/health`). The Docker/Caddy VM (§3) needs no ticket at all.
