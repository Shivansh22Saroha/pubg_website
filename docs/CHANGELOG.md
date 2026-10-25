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
