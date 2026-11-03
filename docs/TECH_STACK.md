# TECH STACK — RotationLab

**Version policy:** the table lists the *target major version*. When scaffolding, install the latest stable release of that major (`pnpm add <pkg>@<major>`), commit `pnpm-lock.yaml`, and record the exact resolved versions in `CHANGELOG.md`. Do not jump to a new major (or a beta/RC) without updating this file. If a listed major has been superseded by a newer stable major at build time, check its migration guide first and note the decision here.

## 1. Runtime & tooling
| Tool | Target | Why |
|---|---|---|
| Node.js | 22 LTS (24 LTS acceptable) | LTS, native fetch, good `sharp` prebuilt binaries |
| pnpm | 9.x+ (via corepack) | fast, strict workspaces |
| Turborepo | 2.x | task caching across `web`, `server`, `shared` |
| TypeScript | 5.x, `strict: true`, `noUncheckedIndexedAccess: true` | safety across shared types |
| ESLint | 9.x flat config + `typescript-eslint` | lint |
| Prettier | 3.x | formatting |
| Husky + lint-staged | latest | pre-commit lint/format |

## 2. Frontend (`apps/web`)
| Library | Target | Purpose |
|---|---|---|
| Next.js | 15.x or 16.x (App Router) | routing, SSR for shell pages, middleware auth guard |
| React / React DOM | 19.x | UI (required by react-leaflet 5) |
| Tailwind CSS | 4.x | styling with design tokens from UI_UX_SPEC |
| shadcn/ui (Radix primitives) | latest CLI | accessible components |
| lucide-react | latest | icons |
| Leaflet | 1.9.x (stay on 1.x; 2.0 is a breaking rewrite) | map engine, `CRS.Simple`, tile layer, canvas renderer |
| react-leaflet | 5.x | React bindings — map rendered client-only (`dynamic(..., { ssr: false })`) |
| Zustand | 5.x | board/UI/presence stores (with `immer` middleware) |
| TanStack Query | 5.x | REST fetching/caching |
| socket.io-client | 4.8.x | realtime |
| react-hook-form + @hookform/resolvers | 7.x | forms with Zod |
| zod | 3.x (or 4.x — pick one for whole monorepo) | validation (from `packages/shared`) |
| sonner | latest | toasts |
| simplify-js | 1.x | stroke point simplification |
| uuid | 10.x+ (`v7`) | client element/op ids |
| html-to-image or leaflet-image alternative | latest | PNG export (render tiles + vector canvas to one canvas) |
| next-themes | – | not needed (dark only in v1) |
| @sentry/nextjs | 11.x (Phase 10) | browser + Next-server error reports; loaded only when `NEXT_PUBLIC_SENTRY_DSN` is set |

Drawing approach: **custom tool layer on Leaflet**, not Leaflet.draw / Geoman. Elements are rendered as Leaflet vector layers using a shared `L.canvas()` renderer (fast for thousands of shapes) and markers as `L.marker` with `divIcon` SVG. Tools are plain TS classes handling pointer events → produce `ElementInput`. Reason: full control over the data model, realtime previews and undo; plugin editors fight with our sync model.

## 3. Backend (`apps/server`)
| Library | Target | Purpose |
|---|---|---|
| Fastify | 5.x | HTTP server |
| @fastify/cookie, @fastify/helmet, @fastify/rate-limit, @fastify/sensible | matching Fastify 5 | security & utils |
| fastify-type-provider-zod | latest | route schemas from Zod |
| socket.io | 4.8.x | realtime |
| @socket.io/redis-adapter | 8.x | multi-instance broadcast |
| ioredis | 5.x | Redis client |
| Prisma (+ @prisma/client) | 6.x (evaluate 7.x if stable) | ORM, migrations |
| @node-rs/argon2 | latest | argon2id hashing (prebuilt, no node-gyp) |
| jose | 5.x+ | JWT sign/verify |
| pino + pino-pretty (dev) | 9.x | structured logging |
| node-cron | 3.x | background jobs |
| nodemailer | 10.x (Phase 10: 6.x had 5 high advisories, fixed in ≥ 10.0.6; ships its own types) | email (P1, behind flag) |
| @sentry/node | 11.x | optional error tracking (Sentry 11: privacy via `dataCollection`, not `sendDefaultPii`) |
| prom-client | 15.x | metrics |

## 4. Shared (`packages/shared`)
zod, TypeScript only. Exports: schemas, types (`z.infer`), `MAPS` registry, `PERMISSIONS`, limits, socket event maps:
```ts
export interface ClientToServerEvents { 'element:upsert': (p: ElementUpsert, ack: Ack<{ seq: number }>) => void; ... }
export interface ServerToClientEvents { 'board:op': (p: BoardOp) => void; ... }
```
Both `io<ServerToClientEvents, ClientToServerEvents>()` and `new Server<ClientToServerEvents, ServerToClientEvents>()` use these.

## 5. Map tiles (`packages/map-tiles`)
| Tool | Purpose |
|---|---|
| sharp (latest, libvips) | slicing 8k+ PNGs into WebP XYZ tiles (`.tile({ layout: 'google' })`) |
| git + git-lfs | download high-res art |
| file-type | magic-byte detection (Rondo low-res is JPEG named .png) |
| rclone (optional CLI) | upload tiles to R2/S3 |

## 6. Data & infrastructure
| Component | Target | Notes |
|---|---|---|
| PostgreSQL | 16 or 17 | `citext` extension |
| Redis | 7.x (or Valkey 8) | adapter pub/sub, presence, rate limits, caches |
| Caddy | 2.x (2.10 image) | reverse proxy, automatic HTTPS, headers |
| Docker / Compose | 27.x / v2 | dev & prod |
| Object storage + CDN | Cloudflare R2 + Cloudflare CDN (or AWS S3 + CloudFront) | map tiles, board thumbnails |
| Hosting (v1) | Single VM (e.g. Hetzner CX22 / DigitalOcean 2 vCPU 4 GB / AWS Lightsail) | all containers; scale out later |
| CI/CD | GitHub Actions + GHCR images | see DEPLOYMENT.md |
| Monitoring | Sentry (errors), Uptime Kuma or Better Stack (uptime), Prometheus/Grafana optional | |

## 7. Testing
| Tool | Use |
|---|---|
| Vitest | unit tests (shared, server services, web stores/tools) |
| @testing-library/react + jsdom | component tests |
| Supertest (or `fastify.inject`) | REST integration |
| socket.io-client in tests | realtime integration |
| Testcontainers (Postgres, Redis) | real DB in integration tests |
| Playwright | E2E, multi-browser-context collaboration tests |
| @axe-core/playwright (4.13) | E2E-13 accessibility scans (Phase 9) |
| lighthouse (13.x, Node API) | `pnpm --filter web test:lighthouse` on landing + dashboard through Playwright's Chromium (Phase 9) |
| k6 (1.3, `grafana/k6` Docker image — not a repo dependency) | realtime load test (`loadtest/realtime.js`, Phase 10) |
| OWASP ZAP baseline (`ghcr.io/zaproxy/zaproxy:stable`) | DAST, nightly against staging; accepted warnings in `.zap/rules.tsv` |
| gitleaks (8.30, Docker image) | secret scan of the full history in CI |

## 8. Explicitly rejected (and why)
| Option | Reason |
|---|---|
| Firebase / Supabase Realtime | wanted full control of sync semantics and auth; self-hostable |
| Yjs / CRDT | shapes are independent objects → per-element LWW is simpler and sufficient; CRDT adds complexity for little gain (revisit if collaborative text editing is added) |
| Konva/Fabric canvas over a static image | loses smooth deep-zoom tiling; Leaflet gives pan/zoom and tile pyramids for 8k+ images for free |
| MongoDB | relational model (rooms/members/roles) fits Postgres; JSONB covers geometry |
| NextAuth/Auth.js | separate Fastify backend owns auth; custom flow is small and explicit |
| Storing tokens in localStorage | XSS exposure |
