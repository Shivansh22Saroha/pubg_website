# ENVIRONMENT — RotationLab

All config comes from environment variables, parsed and validated at boot with Zod (`apps/server/src/config.ts`, `apps/web/src/env.ts`). **The app must refuse to start if a required variable is missing or invalid.**

Files:
- `apps/server/.env.example` → copy to `.env`
- `apps/web/.env.example` → copy to `.env.local`
- `packages/map-tiles/.env.example` → copy to `.env` (only for tile upload)
- Production: values injected by Docker Compose `env_file` from a file **outside the repo** (e.g. `/opt/rotationlab/.env.prod`, mode 600) or by the platform's secret manager.

Generate secrets with: `openssl rand -base64 48`

## 1. Server (`apps/server/.env`)

| Variable | Required | Example (dev) | Description |
|---|---|---|---|
| `NODE_ENV` | ✓ | `development` | `development` \| `test` \| `production` |
| `PORT` | ✓ | `4000` | HTTP + Socket.IO port |
| `APP_ORIGIN` | ✓ | `http://localhost:3000` | exact browser origin; used for Origin/CSRF checks and cookie logic |
| `DATABASE_URL` | ✓ | `postgresql://rl:rl_dev_pw@localhost:5432/rotationlab?schema=public` | Postgres connection |
| `REDIS_URL` | ✓ | `redis://:redis_dev_pw@localhost:6379/0` | Redis connection |
| `JWT_SECRET` | ✓ | *(48+ random bytes base64)* | HS256 signing key for access tokens |
| `JWT_SECRET_PREVIOUS` | – | | accepted for verification during rotation |
| `JWT_ISSUER` | ✓ | `rotationlab` | `iss` claim |
| `JWT_AUDIENCE` | ✓ | `rotationlab-web` | `aud` claim |
| `ACCESS_TOKEN_TTL_SEC` | – | `900` | default 900 |
| `REFRESH_TOKEN_TTL_DAYS` | – | `30` | default 30 |
| `COOKIE_SECURE` | ✓ | `false` (dev) / `true` (prod) | Secure flag; must be `true` when `NODE_ENV=production` (enforced) |
| `COOKIE_DOMAIN` | – | | leave empty for host-only cookies (recommended) |
| `IP_HASH_SALT` | ✓ | *(random)* | salt for hashing IPs in logs/audit |
| `ARGON2_MEMORY_KIB` | – | `19456` | argon2id memory cost |
| `ARGON2_ITERATIONS` | – | `2` | argon2id time cost |
| `MAX_ROOM_MEMBERS` | – | `16` | default room member cap |
| `MAX_BOARDS_PER_ROOM` | – | `20` | |
| `MAX_ELEMENTS_PER_BOARD` | – | `5000` | |
| `MAX_OWNED_ROOMS` | – | `30` | |
| `CORS_DEV_ORIGINS` | – | `http://localhost:3000` | only honoured when `NODE_ENV=development` |
| `TRUST_PROXY` | ✓ | `false` (dev) / `true` (prod behind Caddy) | so `req.ip` is the real client IP |
| `LOG_LEVEL` | – | `debug` | `fatal…trace` |
| `EMAIL_ENABLED` | – | `false` | enables verification + reset flows |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | if email | `smtp.resend.com` / `587` / … / `RotationLab <no-reply@example.com>` | outgoing mail |
| `CAPTCHA_PROVIDER` | – | `none` | `none` \| `turnstile` \| `hcaptcha` (register form) |
| `CAPTCHA_SECRET` | if captcha | | server-side verify key |
| `S3_ENDPOINT` | P1 | `https://<acct>.r2.cloudflarestorage.com` | for board thumbnails |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_REGION` | P1 | `rotationlab-assets` / … / `auto` | |
| `PUBLIC_ASSETS_BASE_URL` | P1 | `https://assets.example.com` | public URL for thumbnails |
| `DEMO_BOARD_IDS` | – | `uuid1,uuid2,uuid3` | boards exposed read-only at `/explore` |
| `SENTRY_DSN` | – | | error tracking |
| `METRICS_TOKEN` | – | | if set, `/metrics` requires `Authorization: Bearer` (in addition to internal-only routing) |
| `SEED_DEV_PASSWORD` | dev only | `devpassword123!` | password for seeded users; seeding refuses to run in production |

## 2. Web (`apps/web/.env.local`)

Only `NEXT_PUBLIC_*` variables reach the browser — **never** put secrets there.

| Variable | Required | Example | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ORIGIN` | ✓ | `http://localhost:3000` | own origin |
| `NEXT_PUBLIC_API_BASE` | ✓ | `/api/v1` | relative in all envs (same origin) |
| `NEXT_PUBLIC_SOCKET_PATH` | ✓ | `/realtime` | |
| `NEXT_PUBLIC_TILES_BASE_URL` | ✓ | `/tiles` (dev) / `https://tiles.example.com/v1` (prod) | tile root; map paths appended |
| `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | if captcha | | |
| `NEXT_PUBLIC_SENTRY_DSN` | – | | |
| `INTERNAL_API_URL` | ✓ | `http://localhost:4000` (dev) / `http://server:4000` (docker) | server-side calls from Next middleware/RSC |

### Dev proxying
In development, `next.config.ts` rewrites `/api/:path*` and `/realtime/:path*` → `http://localhost:4000` so the browser still sees a single origin (cookies work exactly like prod). Socket.IO websocket upgrade through Next rewrites can be unreliable — if so, connect the socket directly to `http://localhost:4000` in dev only (`NEXT_PUBLIC_SOCKET_URL`) with CORS dev origins enabled.

| `NEXT_PUBLIC_SOCKET_URL` | dev only, optional | `http://localhost:4000` | direct socket URL fallback |

## 3. Map tiles (`packages/map-tiles/.env`)
| Variable | Example | Description |
|---|---|---|
| `PUBG_ASSETS_REPO` | `https://github.com/pubg/api-assets` | source |
| `PUBG_ASSETS_REF` | `master` | branch or pinned commit SHA (pin for reproducibility) |
| `TILE_FORMAT` | `webp` | `webp` \| `png` \| `jpeg` |
| `TILE_QUALITY` | `82` | |
| `OUT_DIR` | `./out` | |
| `RCLONE_REMOTE` | `r2:rotationlab-tiles/v1` | upload target |

## 4. Services

| Service | Dev | Prod |
|---|---|---|
| PostgreSQL | `docker compose` service `postgres` (port 5432, volume `pgdata`) | same container on private network, or managed (Neon/RDS) |
| Redis | `docker compose` service `redis` with `--requirepass` | same, `appendonly yes` |
| Tiles | files copied to `apps/web/public/tiles` | Cloudflare R2 bucket + custom domain `tiles.example.com`, CORS allow `APP_ORIGIN` |
| Email | Mailpit container (`localhost:8025` UI) when `EMAIL_ENABLED=true` | Resend / Postmark / SES SMTP |
| Reverse proxy | not needed (Next rewrites) | Caddy |

### docker-compose.yml (dev excerpt)
```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: rl, POSTGRES_PASSWORD: rl_dev_pw, POSTGRES_DB: rotationlab }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U rl"], interval: 5s, retries: 10 }
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "redis_dev_pw", "--appendonly", "yes"]
    ports: ["6379:6379"]
  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
    profiles: ["email"]
volumes: { pgdata: {} }
```

## 5. Environment matrix
| Setting | development | test (CI) | staging | production |
|---|---|---|---|---|
| `COOKIE_SECURE` | false | false | true | true |
| `TRUST_PROXY` | false | false | true | true |
| CORS | localhost:3000 | – | none | none |
| Seed data | yes | per-test | demo only | demo boards only |
| `LOG_LEVEL` | debug | warn | info | info |
| Captcha | none | none | turnstile (test keys) | turnstile |
| Sentry | off | off | on | on |

## 6. Config validation (server sketch)
```ts
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().default(4000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).transform(v => v === 'true'),
  // …
}).superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && !e.COOKIE_SECURE)
    ctx.addIssue({ code: 'custom', message: 'COOKIE_SECURE must be true in production' });
});
export const env = Env.parse(process.env);
```
Use this `enum → transform` pattern for every boolean variable. Do **not** use `z.coerce.boolean()`: it turns the string `"false"` into `true`.
