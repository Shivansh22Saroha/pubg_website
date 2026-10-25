# TODO — RotationLab

Build **phase by phase, in order**. Each phase ends with: tests green, CHANGELOG entry, boxes ticked here, and a short demo note. Don't start a phase until the previous one passes its exit criteria.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **P0/P1/P2** = priority from PRD.

---

## Phase 0 — Assets & decisions (do first, mostly manual)
- [ ] Read PUBG Developer Terms of Use + Player-created Content policy; confirm non-commercial fan use is OK; write the attribution text.
- [ ] Decide final product name + domain.
- [ ] Verify grid letter scheme (A–H columns, I–P rows) against the in-game map.
- [ ] Verify Rondo world size is 816 000 cm (8×8 km).
- [ ] Collect verified zone phase radii for Erangel / Miramar / Rondo (or ship presets disabled).
- [ ] Answer PRD §8 open questions.

**Exit:** decisions written into PRD / `maps.ts` constants.
_Status 2026-10-25: open. Doc defaults are in use and marked `TODO(phase0)` in `packages/shared/src/{maps,brand}.ts`._

## Phase 1 — Scaffold (P0)
- [x] pnpm workspace + Turborepo: `apps/web`, `apps/server`, `packages/shared`, `packages/map-tiles`.
- [x] TypeScript strict configs, ESLint, Prettier, Husky + lint-staged.
- [x] `docker-compose.yml` with Postgres + Redis (+ Mailpit profile).
- [x] Server: Fastify boot, Zod env config, pino logger, `/api/health`, error handler with standard error shape.
- [x] Web: Next.js App Router, Tailwind with UI_UX_SPEC tokens, fonts, shadcn init, dark layout shell.
- [x] Next rewrites `/api` + `/realtime` → server (dev).
- [x] GitHub Actions CI: install, lint, typecheck, unit tests, build.

**Exit:** `pnpm dev` shows a styled placeholder page calling `/api/health` successfully; CI green.
_Status 2026-10-25: met locally (lint, typecheck, 32 tests, build all pass; page shows db/redis ok). CI workflow written but not yet run on GitHub — no remote configured._

## Phase 2 — Map tiles & map viewer (P0)
- [x] `map-tiles fetch`: sparse clone + `git lfs pull` 6 files, SHA-256 verify.
- [x] `map-tiles build`: magic-byte detection, size check/padding, WebP XYZ tiles (`layout: 'google'`), previews, thumbnails, `manifest.json`.
- [x] `packages/shared/maps.ts` registry from manifest values.
- [x] `lib/coords.ts`: custom CRS, world↔LatLng, gridRef, distance + unit tests.
- [x] `MapCanvas` (client-only) with tile layer, labels/clean toggle, low-res placeholder, maxBounds.
- [x] Grid layer (major + minor), HUD cursor readout, zoom controls, fit button.
- [x] Standalone `/maps/[mapId]` dev page to eyeball all 3 maps.

**Exit:** all three maps pan/zoom smoothly at all zoom levels; grid refs match known locations; E2E-10 passes.
_Status 2026-10-25: met — verified in Chrome on real tiles (all zooms −1…7, no tile 404s, instant labels swap, grid on the art edges); E2E-10 green in dev and CI (build) mode. Grid letters vs in-game still a Phase 0 item._

## Phase 3 — Auth (P0)
- [ ] Prisma schema: users, refresh_tokens (+ migration with citext & CHECKs).
- [ ] argon2id service, breached-password check, token service (jose), refresh rotation + reuse detection.
- [ ] Routes: register, login, refresh, logout, logout-all, username-available, `/me`, `PATCH /me`.
- [ ] Cookie config, CSRF (Origin + header) plugin, rate limits (Redis store), lockout.
- [ ] Web: login/register pages, API client with refresh-on-401, middleware guard with safe `redirectTo`.
- [ ] Tests: unit + integration per TESTING §3/§4 (Auth, CSRF, rate limits).

**Exit:** E2E-1 passes; security tests for auth pass.

## Phase 4 — Rooms, members, invites, boards (P0)
- [ ] Prisma: rooms, room_members, room_invites, boards, layers (+ partial unique OWNER index).
- [ ] `permissions.ts` + `policy.ts`; authz matrix test harness.
- [ ] Room CRUD, members (role change, kick), invites (create/list/revoke/preview/accept with row-locked use count), boards CRUD/duplicate/reorder.
- [ ] Web: dashboard (cards, empty state, new-room dialog, join-with-code), `/join/[code]`, room shell with board tabs (no drawing yet), room settings dialog, invite dialog, members panel.

**Exit:** E2E-2 (without realtime presence) passes; authz matrix green for all routes so far.

## Phase 5 — Realtime core (P0)
- [ ] Socket.IO server with cookie auth + Origin check, Redis adapter, typed events from shared.
- [ ] `room:join/leave`, presence (Redis hash + heartbeat), `presence:update`.
- [ ] `board:subscribe` (full + delta), elements table, board_ops log, seq allocation txn, opId dedupe.
- [ ] `element:upsert/delete/batch`, `layer:*` handlers with validation, limits, lock checks.
- [ ] Per-socket rate limiting; kick/role change → socket enforcement.
- [ ] Web: socket singleton, `boardStore` (optimistic, ack, reject rollback, LWW), reconnect & resync, sync indicator.
- [ ] Element renderer layer (canvas renderer + marker divIcons) — render from store.

**Exit:** realtime integration tests (TESTING §4) green; two browsers see each other's programmatically created elements.

## Phase 6 — Drawing tools (P0)
- [ ] Tool framework (pointer handling, drafts, cursor per tool, Esc cancel).
- [ ] Select (click, multi, marquee, move, circle resize, delete, duplicate).
- [ ] Pen (sampling + simplify), Line, Arrow (multi-point), Circle, Polygon, Text, Marker (flyout + auto-number), Eraser.
- [ ] Style bar (palette, width, dashed, fill), last style per tool.
- [ ] Layers panel (add, rename, color, visibility, lock, reorder, delete, active layer).
- [ ] Undo/redo (inverse ops, seq-mismatch skip).
- [ ] `stroke:preview` ghosts for others.
- [ ] Keyboard shortcuts + `?` help dialog.

**Exit:** E2E-3, E2E-5, E2E-8, E2E-9 pass; 1 000-element perf benchmark within target.

## Phase 7 — Collaboration extras & chat (P0/P1)
- [ ] Live cursors (20 Hz throttle, fade), presence dots on board tabs.
- [ ] Chat: send, history pagination, system messages, delete, unread badge.
- [ ] Map pings (📍 button, Alt+click), ping chip fly-to + pulse.
- [ ] Laser pointer (P1), follow & summon (P1).

**Exit:** E2E-4, E2E-6 pass.

## Phase 8 — Snapshots, measure, export, settings (P1)
- [ ] Snapshots: save, list, preview modal, restore with auto-snapshot, `board:reset`.
- [ ] Measure tool with travel time (approx. label).
- [ ] Zone presets dropdown (values from Phase 0 or hidden behind flag).
- [ ] PNG export with footer attribution (tiles CORS configured).
- [ ] Settings page: profile, change password, sessions, delete account flow (ownership transfer).
- [ ] Email verification + password reset behind `EMAIL_ENABLED`.

**Exit:** E2E-7, E2E-11 pass.

## Phase 9 — Landing, explore mode, responsive, a11y (P1)
- [ ] Landing page + footer attribution/notice "PC map art — BGMI may differ".
- [ ] `/explore` read-only demo boards.
- [ ] Tablet layout (bottom toolbar, bottom sheet), phone view + chat mode, touch gestures.
- [ ] Coach-mark onboarding tour.
- [ ] Axe pass, keyboard-only pass, reduced-motion.

**Exit:** E2E-12, E2E-13 pass; Lighthouse targets met.

## Phase 10 — Hardening & launch
- [ ] Security headers + CSP nonces verified; ZAP baseline clean; gitleaks/audit clean.
- [ ] k6 load test meets targets on staging VM.
- [ ] Backups + restore test, uptime monitoring, Sentry.
- [ ] Deploy pipeline (staging auto, prod on tag with approval), rollback tested.
- [ ] `security.txt`, privacy page, terms page.
- [ ] Tag `v1.0.0`, update CHANGELOG.

---

## Backlog (post-v1)
| Item | Priority |
|---|---|
| Discord / Google OAuth login | P1 (v1.1) |
| Public read-only share link for a board | P1 (v1.1) |
| Board thumbnails on dashboard (client-generated, S3) | P1 |
| Element list view for screen readers | P2 |
| Minimap | P2 |
| Typing indicator | P2 |
| Double-headed arrows, curved arrows | P2 |
| Link own-player markers to members (auto IGN) | P2 |
| "Save measure as line" | P2 |
| Zone simulator (random phase sequence generator with shrink animation) | P2 |
| Timeline / step playback of a rotation (keyframes per board) | P2 |
| PUBG API match telemetry replay overlay (positions over time) — world units already compatible | P3 |
| More maps from the same repo: Sanhok, Vikendi, Karakin, Taego, Deston (config + tiles only) | P2 |
| Hindi UI translation | P3 |
| Voice chat (WebRTC SFU) — likely never; Discord covers it | P3 |
| Vehicle/item icons from PUBG `Assets/Vehicle` & `Assets/Item` for markers | P2 |

## Known risks / watch list
- Licensing of PUBG map art for a public site (Phase 0).
- Very large source PNGs (~95–122 MB each) → tile build needs ~4–8 GB RAM; run locally, not in CI.
- `Rondo_Main_Low_Res.png` is JPEG-encoded despite `.png` name — handle by magic bytes.
- Next.js rewrites may not proxy websocket upgrades reliably in dev → use direct socket URL fallback.
- Leaflet 2.0 is a breaking rewrite — stay on 1.9.x for v1.

## Bugs
_None yet — log as `- [ ] BUG-<n>: description (found in phase X, repro steps)`._
