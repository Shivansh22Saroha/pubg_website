# CHANGELOG — RotationLab

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

**Rules for the coding AI**
- Add an entry under `[Unreleased]` at the end of every phase/PR: what was built, what changed, what was fixed.
- Use sections: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Docs`.
- Reference PRD/feature IDs (e.g. `DRAW-3`) and TODO phase.
- On release, move `[Unreleased]` items under a new version heading with the date.
- Record exact dependency versions resolved at scaffold time (see TECH_STACK.md version policy).

---

## [Unreleased]

### Docs
- 2026-10-25 — Initial specification pack created: README, PRD, ARCHITECTURE, UI_UX_SPEC, DATABASE_SCHEMA, API_SPEC, SECURITY, TECH_STACK, USER_FLOWS, FEATURES, ENVIRONMENT, TESTING, DEPLOYMENT, CHANGELOG, TODO.
- Verified PUBG `api-assets` map files: high-res art for Erangel (~95 MB), Miramar (~112 MB) and Rondo (~118–122 MB) is stored in Git LFS with labelled (`_Main_`) and unlabelled (`_Main_No_Text_`) variants; low-res variants are 819×819; `Rondo_Main_Low_Res.png` is actually JPEG data. Telemetry names: Erangel `Erangel_Main`/`Baltic_Main`, Miramar `Desert_Main`, Rondo `Neon_Main`.

### Added
- 2026-10-25 — **Phase 1 scaffold** (TODO Phase 1):
  - pnpm workspace + Turborepo with `apps/web`, `apps/server`, `packages/shared`, `packages/map-tiles` (stub CLI for Phase 2).
  - Strict TypeScript (`strict`, `noUncheckedIndexedAccess`), ESLint 9 flat config (`typescript-eslint` strict type-checked, Next + react-hooks rules, bans `dangerouslySetInnerHTML` and `localStorage`), Prettier, Husky pre-commit running lint-staged.
  - `docker-compose.yml`: Postgres 17 + Redis 7 (password, AOF) bound to 127.0.0.1, Mailpit under the `email` profile. Host ports can be overridden with `POSTGRES_PORT` / `REDIS_PORT` in a root `.env`.
  - `packages/shared`: Zod 4 schemas for the uniform API error body + all error codes (API_SPEC §1.4) and `HealthResponse`; Phase 0 map constants (`maps.ts`), product name and attribution text (`brand.ts`).
  - Server: Fastify 5 with `fastify-type-provider-zod`, Zod env config that fails fast (ENVIRONMENT §6; `"false"`-safe booleans; `COOKIE_SECURE` required in production), pino logging with redaction, UUID request ids (client ids ignored), 100 KB body limit, error handler that returns the standard error shape and never leaks internals, `GET /api/health` probing Postgres (Prisma `SELECT 1`) and Redis (`PING`) with 1.5 s timeouts → 200 `ok` / 503 `degraded`.
  - Web: Next.js 16 App Router, Tailwind 4 with UI_UX_SPEC §2 tokens (colors, drawing palette, radii, shadow, motion, focus ring, reduced motion), Rajdhani / Inter / JetBrains Mono via `next/font`, shadcn config + `cn()` + `Button`, dark layout shell, placeholder page with a live system-status card that calls `/api/health`, footer attribution + BGMI notice. Zod-validated public env (`src/env.ts`).
  - Dev rewrites `/api/*` and `/realtime/*` → `INTERNAL_API_URL` (default `http://localhost:4000`).
  - GitHub Actions CI: install (frozen lockfile), lint + Prettier check, typecheck, unit tests, build.
  - Tests (Vitest): 32 tests across shared (schemas, constants), server (config, error handler, health via `fastify.inject`) and web (`HealthStatus` with Testing Library + jsdom).

- 2026-10-25 — **Phase 2: map tiles & map viewer** (TODO Phase 2; MAP-1, MAP-2, MAP-3, MAP-4):
  - `map-tiles run fetch` (pure Node, works in PowerShell / cmd / Git Bash): checks git + git-lfs, does a sparse, shallow, blobless clone of `pubg/api-assets` into `packages/map-tiles/.cache/` (gitignored), then `git lfs pull`s only the 6 high-res files. The 3 low-res files are ordinary blobs. Each LFS file's SHA-256 and size are verified against the pointer `oid` read from the commit. Formats are detected by magic bytes (`file-type`); `Rondo_Main_Low_Res.png` is confirmed to be JPEG. Writes `.cache/sources.json` with the pinned commit `32b13b5`.
  - `map-tiles run build`: measures every image with sharp and decodes with `limitInputPixels` = the measured pixel count. Requires square art and pads right/bottom to 256·2^k when needed. Processes one image at a time with sharp's cache off. Writes WebP q82 XYZ tiles (`layout: 'google'` → `{z}/{y}/{x}.webp`), checks the tile count is complete, and writes 1024 px preview, 256 px thumb and low-res JPEG placeholders plus `out/manifest.json` (sourceSize, paddedSize, maxNativeZoom, sha256, tileCount, bytes). Accepts an optional map list.
  - `map-tiles run copy-dev` copies `out/` to `apps/web/public/tiles` (gitignored). `map-tiles run fixtures` generates the committed fixture set in `apps/web/e2e/fixtures/tiles`: 126 solid-colour tiles at z0–2 plus placeholders, 225 KB.
  - `packages/shared`: `maps.ts` is now the full registry (`MAPS`, `MapConfig`, `isMapId`, `tileWorldSize`) filled from the manifest, with the Phase 0 markers kept. New `coords.ts` provides `gridRef` (`"F-M 4,7"`), `gridLines`, `distanceMetres`, `pathLengthMetres`, `travelTimeSeconds`, `formatMetres` and `formatDuration`.
  - Web `lib/coords.ts`: custom `CRS.Simple` with `Transformation(256/T, 0, 256/T, 0)`, where T = worldSize scaled by any padding; `toLatLng` / `fromLatLng` / `worldBounds`.
  - Web map, client-only (`next/dynamic`, `ssr: false`):
    - `MapCanvas`: react-leaflet with labels and clean tile layers both mounted and swapped by opacity, so there is no blank flash (`N`, or the HUD button). The 819 px low-res `ImageOverlay` sits in a pane below the tiles. Also `maxBounds` (+10 %), zoom −1…maxNativeZoom+2 in 0.5 steps.
    - `GridLayer`: 1-square major lines plus 1/10 minor lines from zoom 3, on one canvas renderer in a `grid` pane (z 350), toggled with `Shift+G` or the HUD button.
    - `GridLabels`: A–H / I–P letters as React text nodes, pinned to the map edge or the viewport edge, and following zoom animations.
    - `MapHud`: cursor grid ref + metres, labels / grid toggles, zoom −/+, fit.
  - Dev page `/maps/[mapId]` (statically generated for the 3 maps, `noindex`) with a map switcher.
  - Tests: shared 25 (coords per TESTING §3: corners, 102 000 boundary, far edge, sub-squares, distance / time formatting; registry consistency), web 10 (CRS projection, y-down, native scale, round trip at zoom −1…7, padding), and Playwright **E2E-10** for all three maps (fixture tiles served by request interception → no 404s, labels toggle swaps the visible tile URL, grid toggles, HUD readout). CI now runs E2E against the production build.

- 2026-10-25 — **Phase 3: auth** (TODO Phase 3; AUTH-1…4, AUTH-6; SECURITY A1–A8, Z1 harness, V1/V3/V5, T3, §6, §7):
  - Prisma models `users`, `refresh_tokens`, `email_tokens` + migration `auth`. The migration adds raw SQL for `CREATE EXTENSION citext` and these CHECKs: username format, avatar hex colour, failed-login count ≥ 0, token-hash hex, email-token purpose. IDs are UUIDv7 from app code, with `gen_random_uuid()` as the DB fallback.
  - Shared Zod schemas (`schemas/auth.ts`, `text.ts`): register, login, username check, `PublicUser` / `Me`, `PATCH /me`, password change, sessions. `cleanText` (NFC, strip control characters, trim), lengths in code points, hex colour, cookie names, CSRF header, plus password rules / strength helpers for the UI.
  - Server services:
    - argon2id (`@node-rs/argon2`, cost from env, NFC-normalised input, dummy verify for unknown users).
    - Password policy (10–128 chars) plus a breached-password check against the bundled NCSC top-100k list. Only the 9 125 entries with 10–128 chars are kept, lower-cased, 42 KB gzipped, with a reproducible `scripts/build-breached-list.ts`.
    - `jose` HS256 access tokens (claims sub/sid/iss/aud/iat/exp only; `JWT_SECRET_PREVIOUS` accepted for verification).
    - Refresh-token sessions: 256-bit opaque, SHA-256 at rest, rotated on every use with a `SELECT … FOR UPDATE` row lock. Reuse of a rotated token revokes the family; the revocation is committed before the error is raised.
    - Login lockout: 5 failures → 15 min, doubling, capped at 24 h. Postgres is the source of truth and Redis mirrors it.
    - Redis "revoked sid" list, so logout / logout-all / password change / theft kill access JWTs immediately.
  - Routes `/api/v1/auth/{register,login,refresh,logout,logout-all,username-available}` and `/api/v1/me`, `PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`, all with schemas from `packages/shared` via fastify-type-provider-zod 7.
  - Plugins:
    - `@fastify/cookie`: API_SPEC §1.1 attributes; with `COOKIE_SECURE` the access cookie is `__Host-rl_at` and the refresh cookie `__Secure-rl_rt`.
    - CSRF: exact `Origin` = `APP_ORIGIN` and `X-Requested-With: rotationlab` on every non-GET; a missing Origin is rejected.
    - `@fastify/rate-limit` on Redis: global 300/min/IP, login 10/min, register 10/min + 5/hour (second fixed window), username check 20/min.
    - Policy layer (`lib/policy.ts`): every route must declare `config.access` (`public` | `user`), or the server refuses to start.
    - Wider pino redaction.
  - Web:
    - `/login` and `/register` (react-hook-form + zodResolver, 400 ms debounced username check, strength meter + rules list, inline field errors, generic credential error, spinner).
    - `lib/api.ts`: credentials included, CSRF header, typed `ApiError`, one shared refresh call for concurrent 401s, retry once.
    - Next 16 `src/proxy.ts` guard for `/dashboard`, `/rooms`, `/settings`, with a safe `redirectTo` (single leading `/`, no `//`, backslash, control characters or auth-page loops).
    - Silent session restore on `/login`, a protected `/dashboard` placeholder, and a user menu with log out / log out all devices.
    - TanStack Query + sonner providers.
  - Tests:
    - Shared: 42, web: 40.
    - Server unit: 39 (token service incl. alg=none / previous secret, rotation + reuse + grace on an in-memory store, password policy, argon2id, lockout curve).
    - Server integration: 59 on real Postgres + Redis (register / duplicates / validation, login by email and username, generic error, lockout, `/me`, `TOKEN_EXPIRED`, refresh rotation, theft revocation, 409 concurrent refresh, logout, logout-all, password change, sessions, CSRF, rate limits with `Retry-After`, dev and production cookie attributes).
    - A **log-grep test** proving no token, password or cookie value appears in logs, response bodies or URLs. It was mutation-checked: a deliberately logged token makes it fail.
    - **Authz matrix harness**: fails if any route lacks a row.
    - Playwright **E2E-1**: also checks httpOnly cookies, empty local/session storage, no token in any URL, silent restore and an off-site `redirectTo`.
  - CI: Postgres 17 + Redis 7 service containers, `prisma migrate deploy`, `pnpm test:int`; E2E starts the real API (`tsx`) and `next dev`.
- 2026-10-25 — Phase 2 follow-ups:
  - Minor grid lines confirmed at W/80 = 10 200 cm and aligned with the major lines (new unit test).
  - Minor lines now start at zoom `maxNativeZoom − 1` with 30 % opacity, as FEATURES F3 specifies (Phase 2 had used zoom 3 / 20 %).
  - Docs corrected: 1.02 km squares (PRD, ARCHITECTURE §5, FEATURES), measured tile size/time (ARCHITECTURE §6, TODO risks, README), `pnpm --filter map-tiles run …` everywhere.
  - New TODO Phase 9 item: gate the `/maps/[mapId]` dev page in production.

- 2026-10-25 — **Phase 4: rooms, members, invites, boards** (TODO Phase 4; ROOM-1…7, BOARD-1/2, SECURITY Z1–Z3, Z6, Z7):
  - Prisma: `rooms`, `room_members`, `room_invites`, `boards`, `layers` plus the `RoomRole` / `MapId` enums. Migration `rooms_boards` adds raw SQL:
    - a partial unique index for **exactly one OWNER per room**, and a partial index on soft-deleted rooms;
    - CHECKs for room name length, default role ≠ OWNER, max members 2–50, invite role ≠ OWNER, invite max uses > 0, use count ≤ max uses, Crockford invite-code format, board element count 0–5000, board/layer name length, layer hex colour.
  - Shared:
    - `permissions.ts`: the SECURITY §3 matrix as data, plus `can()`, `roleAtLeast()`, `minRole()`.
    - `schemas/rooms.ts`: `RoomSummary` / `RoomDetail` / `Member` / `Board` / `Layer` / `Invite` / `InvitePreview` and every request body; `ROOM_LIMITS`, `DEFAULT_LAYERS` (Plan / Enemies / Zones), invite-code normalise/format helpers.
  - Server:
    - Room policy (`modules/rooms/policy.ts`): (user, room) → role from the DB, cached 30 s in Redis and invalidated on every membership change. 404 for non-members and deleted rooms, 403 for too-low roles, board → room resolution for every board route.
    - Typed `roomEvents` bus (member joined / left / kicked / role changed, room updated / deleted, board created / updated / deleted) for Phase 5's sockets.
  - Routes (API_SPEC §4–5):
    - Rooms: list / create / detail / update, password, soft delete with typed confirmation, leave (not the owner), transfer (owner password).
    - Members: list, role change, kick.
    - Invites: list / create (editors ≤ own role) / revoke (owner or creator); public preview (30/min/IP); accept, which takes row locks on the room and the invite so `max_uses` and `max_members` hold under concurrency. Already a member → 409 `ALREADY_MEMBER` with the `roomId`. Wrong room password is rate-limited at 5 per 10 min per user+room.
    - Boards: list / create (≤ 20; `duplicateFrom` copies layers) / rename / reorder (re-sequenced positions) / delete (owner only, never the last board) / `GET /boards/:id/state`.
    - Room creation is limited to 10/day/user and `MAX_OWNED_ROOMS`.
  - Web:
    - Dashboard (UI_UX_SPEC §3.3): room cards with role, online count, members, last activity and boards; kebab menu with rename / leave / delete; search; skeletons; empty state; new-room dialog with map picker cards and password toggle; join with code.
    - `/join/[code]` (§3.4): preview, log-in / sign-up redirect back, password prompt, all error states, already-member straight in.
    - Room workspace shell (§3.5):
      - top bar with room menu, board tabs (select, `1`–`9`, + new board with default name, rename / duplicate / delete, drag-and-drop reorder), member avatars, Invite, settings, panel toggle (`]`);
      - full-bleed map of the active board, with the last board per room remembered;
      - right panel with Members (owner: role select + kick confirmation), Layers (read-only until Phase 5/6) and a Chat placeholder;
      - invite dialog (§3.7) and room settings dialog (§3.6: General / Security / Danger zone with transfer + typed delete).
    - shadcn-style Dialog, DropdownMenu and Tabs on `radix-ui`.
  - Tests:
    - Shared: 73 (permission matrix table, invite codes, room schemas).
    - Integration: 236, including rooms (create transaction, list scoping, identical 404 for non-member vs missing, owner-only settings, soft delete, role change with immediate cache bust, kick, leave, transfer, DB-level single-OWNER guarantee), invites (codes over 100k draws, expiry, revoke rules, preview, **10 concurrent accepts with max_uses 3 → exactly 3**, concurrent room-full, room password + its rate limit, locked room, creator-role cap, deleted room) and boards (default layers, duplicate, cross-room duplicate 404, 20-board limit, reorder, last-board guard, IDOR).
    - **Authz matrix**: 33 routes × 5 callers (anonymous, outsider, viewer, editor, owner).
    - Playwright **E2E-2** plus join-with-code.

### Decisions (Phase 4)
- `room_invites.role` is NOT NULL (DATABASE_SCHEMA), so an invite created without a role stores the room's `defaultRole` *at creation*. Changing the room default later does not change existing invites.
- Invite role cap (FEATURES F2): the effective role is the lower of the invite's role and the creator's *current* role. A creator who has left the room vouches for VIEWER only.
- `POST /invites/:code/accept` for an existing member → 409 `ALREADY_MEMBER`, with `details: [{ path: 'roomId', issue: <roomId> }]` (API_SPEC says "returns roomId" without a shape).
- Owner `leave` → 403 `FORBIDDEN`; deleting the last board → 409 `CONFLICT`; a wrong password on transfer → 401 `INVALID_CREDENTIALS`. API_SPEC doesn't name these codes.
- Board duplicate keeps the source board's map and ignores `mapId` in the body. It copies layers now and will copy elements once the elements table exists (Phase 5).
- `onlineCount` is 0 and `thumbnailUrl` is null until presence (Phase 5) and thumbnails (P1). Dashboard cards show the room initial instead of a thumbnail.
- `radix-ui` 1.8.1 added: the unified Radix package that shadcn/ui now uses (TECH_STACK lists "shadcn/ui (Radix primitives)").
- The `localStorage` lint rule now also catches `window.localStorage`. `src/lib/prefs.ts` is the single sanctioned access point (per-device UI preferences only, wrapped in try/catch).
- Playwright `expect` timeout raised to 20 s because `next dev` compiles each route on first visit.

### Decisions (Phase 3)
- Integration tests use the docker-compose Postgres / Redis (CI: service containers), not Testcontainers. They run against a separate `rotationlab_test` database and Redis DB 15, truncated / flushed per test. `pnpm test` = unit only, `pnpm test:int` = integration.
- `REFRESH_REUSE_GRACE_SEC` (default 10): a rotated token replayed within 10 s is two tabs refreshing at once → 409, no revocation. The client treats that 409 as success because the winning tab's cookies are already set.
- Access JWTs are revoked immediately (Redis sid list for one token lifetime), not after up to 15 min.
- `POST /auth/logout` is `public` and accepts either cookie, so logging out works with an expired access token; it is idempotent.
- The client refreshes on `UNAUTHENTICATED` as well as `TOKEN_EXPIRED` (see "spec issues" in the Phase 3 report), and `/login` attempts a silent refresh first.
- `RATE_LIMITS_ENABLED` env (cannot be `false` in production), for repeatable local E2E.
- Email verification / password reset (AUTH-7, P1): only the `email_tokens` table and the `EMAIL_ENABLED` flag exist. The routes and pages are deferred to Phase 8. "Forgot password?" is shown as inert text.
- `DELETE /me` (account deletion) stays in Phase 8 with the ownership-transfer rules.
- New dependencies (all in TECH_STACK): `@node-rs/argon2` 2.2.2, `jose` 6.2.13, `@fastify/cookie` 11.1.3, `@fastify/rate-limit` 11.2.1, `uuid` 14.0.3, `@tanstack/react-query` 5.104.5, `react-hook-form` 7.91.0, `@hookform/resolvers` 6.0.0 (Zod 4 compatible), `sonner` 2.0.8.

### Fixed
- 2026-10-25 — README / DEPLOYMENT: `pnpm --filter map-tiles fetch` runs pnpm's built-in `fetch` command, not our script. They now say `pnpm --filter map-tiles run fetch` / `run build`.

### Map tile build results (pubg/api-assets@32b13b5, 2026-10-25)
| Map | Source art | Padded | maxNativeZoom | Tiles (labels + clean) | Tile size on disk |
|---|---|---|---|---|---|
| Erangel | 8192 × 8192 | 8192 (none) | 5 | 1 365 + 1 365 = 2 730 | 24.0 MB |
| Miramar | 8192 × 8192 | 8192 (none) | 5 | 2 730 | 33.5 MB |
| Rondo | 8192 × 8192 | 8192 (none) | 5 | 2 730 | 36.1 MB |
Total 8 190 tiles, 93.6 MB (≈ 113 MB of `out/` including previews). Fetch took 134 s and the build ~22 s on this machine. That is far below the spec's "0.5–1.5 GB, 5–15 min" estimate, because 8192 px art only needs z0–5. At 816 000 cm per side, one source pixel ≈ 0.996 m.

### Decisions (Phase 2)
- Pure world-unit math (`gridRef`, distance, travel time) lives in `packages/shared/src/coords.ts` so the server can reuse it, for example in chat ping messages. Only the Leaflet CRS glue lives in `apps/web/src/lib/coords.ts`.
- Both base variants are always mounted, which preloads both, as UI_UX_SPEC §5 asks. This doubles tile traffic in exchange for an instant labels toggle.
- Tile paths in the registry are relative to `NEXT_PUBLIC_TILES_BASE_URL`.
- E2E serves fixture tiles via Playwright request interception, so it works whether or not real tiles are present. Locally it reuses the `pnpm dev` server on :3000, because Next 16 allows only one `next dev` per app. CI runs `next start` on :3100.
- New dependencies, all from TECH_STACK: leaflet 1.9.4, react-leaflet 5.0.0, @types/leaflet 1.9.22, sharp 0.35.5, file-type 22.2.0, @playwright/test 1.64.1.

### Decisions (Phase 1)
- Zod **4.x** for the whole monorepo (TECH_STACK allows 3 or 4).
- Next.js **16.x** (TECH_STACK allows 15 or 16).
- Stayed on the listed target majors even where newer ones exist: TypeScript 5 (7 is out), ESLint 9 (10 is out), Prisma 6 (7 not evaluated yet — revisit in Phase 3).
- pnpm 10.34.8 pinned through `packageManager` (TECH_STACK: "9.x+"); CI uses Node 22 (`.nvmrc`).
- Prisma was brought in during Phase 1, with an empty schema, so `/api/health` can report a real `db` status. Models arrive in Phase 3.
- `GET /api/health` returns `status: 'degraded'` with HTTP 503 when a dependency is down. API_SPEC §8 only documents the `ok` case.
- The `map-tiles` package is excluded from `pnpm build`. Its `build` script slices tiles and is run manually (README §4).
- Vitest JSX uses Vite's built-in automatic runtime, so `@vitejs/plugin-react` (not in TECH_STACK) was not added.

### Dependencies (resolved)
- Tooling: turbo 2.11.10, typescript 5.9.3, eslint 9.39.5, @eslint/js 9.39.5, typescript-eslint 8.72.0, eslint-config-prettier 10.1.8, @next/eslint-plugin-next 16.4.3, eslint-plugin-react-hooks 7.1.1, globals 17.13.0, prettier 3.9.10, husky 9.1.7, lint-staged 17.6.0, vitest 5.0.5, tsx 4.23.15, @types/node 22.20.5, pnpm 10.34.8
- Shared: zod 4.6.7
- Server: fastify 5.12.7, fastify-type-provider-zod 7.0.0, ioredis 5.11.1, prisma / @prisma/client 6.19.3, pino-pretty 13.2.0 (pino comes in through fastify)
- Web: next 16.4.3, react / react-dom 19.3.1, tailwindcss / @tailwindcss/postcss 4.3.3, lucide-react 1.61.0, clsx 2.1.1, tailwind-merge 3.7.0, class-variance-authority 0.7.1, @types/react / @types/react-dom 19.3.0, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, jsdom 30.1.3
- Images: postgres:17-alpine, redis:7-alpine, axllent/mailpit

---

## Template for future entries

```md
## [0.1.0] — YYYY-MM-DD
### Added
- Phase 1: monorepo scaffold (pnpm + Turborepo), shared package with Zod schemas, Docker Compose dev stack. (TODO P1)
### Security
- argon2id password hashing, refresh-token rotation with reuse detection. (AUTH-1, AUTH-3)
### Dependencies (resolved)
- next 15.x.y, react 19.x.y, leaflet 1.9.x, socket.io 4.8.x, fastify 5.x.y, prisma 6.x.y …
```
