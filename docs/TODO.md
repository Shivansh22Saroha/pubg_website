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
- [x] `pnpm --filter map-tiles run fetch`: sparse clone + `git lfs pull` 6 files, SHA-256 verify.
- [x] `pnpm --filter map-tiles run build`: magic-byte detection, size check/padding, WebP XYZ tiles (`layout: 'google'`), previews, thumbnails, `manifest.json`.
- [x] `packages/shared/maps.ts` registry from manifest values.
- [x] `lib/coords.ts`: custom CRS, world↔LatLng, gridRef, distance + unit tests.
- [x] `MapCanvas` (client-only) with tile layer, labels/clean toggle, low-res placeholder, maxBounds.
- [x] Grid layer (major + minor), HUD cursor readout, zoom controls, fit button.
- [x] Standalone `/maps/[mapId]` dev page to eyeball all 3 maps.

**Exit:** all three maps pan/zoom smoothly at all zoom levels; grid refs match known locations; E2E-10 passes.
_Status 2026-10-25: met — verified in Chrome on real tiles (all zooms −1…7, no tile 404s, instant labels swap, grid on the art edges); E2E-10 green in dev and CI (build) mode. Grid letters vs in-game still a Phase 0 item._

## Phase 3 — Auth (P0)
- [x] Prisma schema: users, refresh_tokens (+ migration with citext & CHECKs).
- [x] argon2id service, breached-password check, token service (jose), refresh rotation + reuse detection.
- [x] Routes: register, login, refresh, logout, logout-all, username-available, `/me`, `PATCH /me`.
- [x] Cookie config, CSRF (Origin + header) plugin, rate limits (Redis store), lockout.
- [x] Web: login/register pages, API client with refresh-on-401, middleware guard with safe `redirectTo`.
- [x] Tests: unit + integration per TESTING §3/§4 (Auth, CSRF, rate limits).

**Exit:** E2E-1 passes; security tests for auth pass.
_Status 2026-10-25: met — 59 integration tests (auth, CSRF, rate limits, cookies, secret-leak log grep, authz matrix) + E2E-1 green. Email verification / reset (AUTH-7, P1) still stubbed behind `EMAIL_ENABLED` → Phase 8._

## Phase 4 — Rooms, members, invites, boards (P0)
- [x] Prisma: rooms, room_members, room_invites, boards, layers (+ partial unique OWNER index).
- [x] `permissions.ts` + `policy.ts`; authz matrix test harness.
- [x] Room CRUD, members (role change, kick), invites (create/list/revoke/preview/accept with row-locked use count), boards CRUD/duplicate/reorder.
- [x] Web: dashboard (cards, empty state, new-room dialog, join-with-code), `/join/[code]`, room shell with board tabs (no drawing yet), room settings dialog, invite dialog, members panel.

**Exit:** E2E-2 (without realtime presence) passes; authz matrix green for all routes so far.
_Status 2026-10-25: met — E2E-2 green; authz matrix 33 routes × 5 callers (165 cells) green; 236 integration tests. Board duplicate copies layers only until the elements table lands (Phase 5)._

## Phase 5 — Realtime core (P0)
- [x] Socket.IO server with cookie auth + Origin check, Redis adapter, typed events from shared.
- [x] `room:join/leave`, presence (Redis hash + heartbeat), `presence:update`.
- [x] `board:subscribe` (full + delta), elements table, board_ops log, seq allocation txn, opId dedupe.
- [x] `element:upsert/delete/batch`, `layer:*` handlers with validation, limits, lock checks.
- [x] Per-socket rate limiting; kick/role change → socket enforcement.
- [x] Web: socket singleton, `boardStore` (optimistic, ack, reject rollback, LWW), reconnect & resync, sync indicator.
- [x] Element renderer layer (canvas renderer + marker divIcons) — render from store.

**Exit:** realtime integration tests (TESTING §4) green; two browsers see each other's programmatically created elements.
_Status 2026-10-25: **5A (server) done** — 112 realtime tests (38 behaviour + 74-cell socket authz matrix) green, two-instance Redis-adapter test green, `scripts/realtime-smoke.ts` p50 27 ms / p95 40 ms on loopback. **5B (client) done** — exit met: two browsers see each other's elements live (E2E: 20 elements < 1 s + move, presence + cursors, offline queue, API kill/restart, kick); 1 000-element pan avg 18.6 ms/frame (headless); 369 integration tests, 12 E2E, smoke p50 21 ms / p95 27 ms._

## Phase 6 — Drawing tools (P0)
- [x] Tool framework (pointer handling, drafts, cursor per tool, Esc cancel).
- [x] Select (click, multi, marquee, move, circle resize, delete, duplicate).
- [x] Pen (sampling + simplify), Line, Arrow (multi-point), Circle, Polygon, Text, Marker (flyout + auto-number), Eraser.
- [x] Style bar (palette, width, dashed, fill), last style per tool.
- [x] Layers panel (add, rename, color, visibility, lock, reorder, delete, active layer).
- [x] Undo/redo (inverse ops, seq-mismatch skip).
- [x] `stroke:preview` ghosts for others.
- [x] Keyboard shortcuts + `?` help dialog.

**Exit:** E2E-3, E2E-5, E2E-8, E2E-9 pass; 1 000-element perf benchmark within target.

## Phase 7 — Collaboration extras & chat (P0/P1)
- [x] Live cursors (20 Hz throttle, fade), presence dots on board tabs. _(done early in Phase 5B)_
- [x] Chat: send, history pagination, system messages, delete, unread badge.
- [x] Map pings (📍 button, Alt+click), ping chip fly-to + pulse.
- [x] Laser pointer (P1), follow & summon (P1).

**Exit:** E2E-4, E2E-6 pass.

## Phase 8 — Snapshots, measure, export, settings (P1)
- [x] Snapshots: save, list, preview modal, restore with auto-snapshot, `board:reset`.
- [x] Auto-snapshot before "Clear layer" (moved from Phase 6; every non-empty clear since the Phase 9 follow-up).
- [x] Measure tool with travel time (approx. label).
- [x] Zone presets dropdown (values from Phase 0 or hidden behind flag) — still empty (`TODO(phase0)`), dropdown hidden; plumbing unit-tested with injected presets.
- [x] PNG export with footer attribution (tiles CORS configured — DEPLOYMENT §4 R2 rule).
- [x] Settings page: profile, change password, sessions, delete account flow (ownership transfer).
- [x] Email verification + password reset behind `EMAIL_ENABLED`.
- [x] Background jobs: purgeDeletedRooms, expireInvites, cleanupTokens (ARCHITECTURE §11).

**Exit:** E2E-7, E2E-11 pass.

## Phase 9 — Landing, explore mode, responsive, a11y (P1)
- [x] Landing page + footer attribution/notice "PC map art — BGMI may differ".
- [x] Gate or remove the `/maps/[mapId]` dev page in production (env flag).
- [x] `/explore` read-only demo boards.
- [x] Tablet layout (bottom toolbar, bottom sheet), phone view + chat mode, touch gestures.
- [x] Coach-mark onboarding tour.
- [x] Axe pass, keyboard-only pass, reduced-motion.

**Exit:** E2E-12, E2E-13 pass; Lighthouse targets met.
> Phase 9 result: E2E-12 and E2E-13 pass. Lighthouse (mobile, cold cache, median of 3): landing Performance 95 / Accessibility 100 ✔; dashboard Performance 83 / Accessibility 100 — **2 points under the 85 target** (CHANGELOG, Decisions (Phase 9)).
> 2026-11-03 follow-up: 512 px card image + server-rendered room list → dashboard Performance **91** / Accessibility 100, landing 95 / 100 (median of 5, AC power). **Exit criteria met.**

## Phase 10 — Hardening & launch
Split (2026-11-03, no staging/production servers yet): **10A** is everything that can be built and verified in the repo and against the production stack on local Docker; **10B** needs the real VMs.

### 10A — in the repo, rehearsed locally ✅
- [x] Security headers + CSP nonces verified (web proxy nonce CSP, helmet on the API, Caddy edge headers, E2E zero-violation walk); ZAP baseline clean (0 failures, accepted warnings in `.zap/rules.tsv`); gitleaks clean; audit clean (nodemailer 6 → 10; one accepted advisory, SECURITY §9).
- [x] k6 realtime load test written (`loadtest/realtime.js` + `scripts/loadtest-seed.ts`) and run against the production images — fixes it forced: glibc server image, batched cursors, fewer queries per op. Local results in CHANGELOG; the 500-user target can only be judged off-box (10B).
- [x] Backups (`deploy/backup.sh`, age-encrypted) + restore test (`deploy/restore.sh` into a scratch DB) — rehearsed; Sentry wired for server and web (off until a DSN is set); `/metrics`; maintenance mode.
- [x] Deploy pipeline written (`deploy.yml`: staging on green `main`, prod on `v*` behind the `production` environment) with `deploy.sh` smoke test + automatic rollback — rollback rehearsed with a broken release.
- [x] `security.txt` (Phase 9), privacy page, terms page (placeholders, `TODO(phase0)` until reviewed).

**Exit (10A):** lint / typecheck / unit / integration / E2E green; production stack rehearsal (§9 DEPLOYMENT) passes.

### 10B — needs the VMs (blocked on hosting + Phase 0)
- [ ] Provision staging + prod VMs (DEPLOYMENT §6), R2 buckets (tiles, backups, assets — Phase 11 thumbnails), DNS; repo variables / secrets / `production` reviewers.
- [ ] First staging deploy through the pipeline; prod-like rollback test on staging.
- [ ] k6 from a separate machine against the staging VM spec: p95 op broadcast < 400 ms, errors < 0.1 %, server CPU < 70 % (try `--scale server=2` if one process is the limit).
- [ ] ZAP nightly green against staging; securityheaders.com A; SSL Labs A.
- [ ] Backups to R2 running nightly; first monthly restore test on staging.
- [ ] Uptime monitoring (`/api/health` every minute → Discord); Sentry DSNs set.
- [ ] Phase 0 closed (legal text, name/domain) → tag `v1.0.0`, update CHANGELOG.

## Phase 11 — v1.1 (P1/P2 backlog; built while 10B / Phase 0 wait on hosting and decisions)
- [x] Public read-only share link for a board (P1): owner / editor create, revoke, regenerate from the board kebab; random 128-bit token stored hashed, optional expiry; `share_links` table + migration, REST routes, authz-matrix rows; `/s/[token]` read-only (no socket, labels / grid / measure), current state only, rate-limited; never leaks room ids, member names or user ids; CSP zero violations.
- [x] Board thumbnails on the dashboard (P1): 256×256 JPEG generated client-side 30 s after the user's last edit; `PUT /boards/:id/thumbnail` (Editor+, ≤ 100 KB, re-encoded with sharp); storage interface (local disk in dev / tests, S3 / R2 when `S3_*` is set); cards fall back to the map card image; dashboard Lighthouse doesn't regress.
- [x] Minimap (P2): bottom-right 160×160, collapsible, viewport rectangle, click / drag to move; low-res map image; hidden on phone.
- [x] Typing indicator (P2): "X is typing…", volatile, ≤ 1 event / 2 s, cleared after 4 s; `TODO(p2)` removed.
- [x] Drawing extras (P2): double-headed arrow toggle in the style bar; Measure "Save as line" → LINE element (Editor+); both undoable and synced.

**Exit:** lint / typecheck / check:deps / unit / integration / E2E green; both authz matrices complete; frame-time benchmark A/B no regression; realtime smoke run; docs + CHANGELOG updated.
_Status 2026-11-03: met — unit 121 + 71 + 219, integration 552, E2E 53 (+6 in `phase11.spec.ts`); REST matrix 57 routes × 5 callers, socket matrix +`chat:typing`; frame time A/B and dashboard Lighthouse no regression (CHANGELOG, Decisions (Phase 11)); smoke p50 18.5 / p95 23.8 ms. 10B: add the R2 `rotationlab-assets` bucket + `S3_*` / `PUBLIC_ASSETS_BASE_URL` (DEPLOYMENT §4)._

## Phase 12 — P2 batch (no new services; built while 10B / Phase 0 wait)
- [ ] Element list for screen readers (P2): the Phase 9 list (Layers → List) gains a **Location** column (grid ref, e.g. `F-M 4,7`) and a **Show** action (centre the map on the element) for every role, viewers included.
- [ ] Link own-player markers to members (P2, FEATURES F7): an `own_player` marker can be linked to a room member; its label is that member's IGN (else display name), live. The server validates the link (a current member); public views (share link, explore) never see the member id or the auto label.
- [ ] Curved arrows (P2): a "Curved" toggle (style bar, like double-headed) draws an arrow as a smooth curve through its bend points; rendering, hit-testing, thumbnails and export follow the curve.
- [ ] Loot markers with PUBG item icons (P2): a `loot` marker kind whose icon is picked from PUBG's `Icons/Item` + `Icons/CarePackage` (pubg/api-assets@32b13b5) — built by the map-tiles pipeline, deployed with the tiles, fixture icons in tests, a drawn fallback when an icon is missing. Licensing: same open Phase 0 question as the map art.

**Exit:** lint / typecheck / check:deps / unit / integration / E2E green; both authz matrices complete; frame-time A/B no regression; docs + CHANGELOG updated.

---

## Backlog (post-v1)
| Item | Priority |
|---|---|
| Discord / Google OAuth login | P1 (v1.1) |
| ~~Public read-only share link for a board~~ — Phase 11 | P1 (v1.1) |
| ~~Board thumbnails on dashboard (client-generated, S3)~~ — Phase 11 | P1 |
| ~~Element list view for screen readers~~ — built in Phase 9; location + Show in Phase 12 | P2 |
| ~~Minimap~~ — Phase 11 | P2 |
| ~~Typing indicator~~ — Phase 11 | P2 |
| ~~Double-headed arrows~~ (Phase 11), curved arrows | P2 |
| Link own-player markers to members (auto IGN) | P2 |
| ~~"Save measure as line"~~ — Phase 11 | P2 |
| Zone simulator (random phase sequence generator with shrink animation) | P2 |
| Timeline / step playback of a rotation (keyframes per board) | P2 |
| PUBG API match telemetry replay overlay (positions over time) — world units already compatible | P3 |
| More maps from the same repo: Sanhok, Vikendi, Karakin, Taego, Deston (config + tiles only) | P2 |
| Hindi UI translation | P3 |
| Voice chat (WebRTC SFU) — likely never; Discord covers it | P3 |
| Vehicle/item icons from PUBG `Assets/Vehicle` & `Assets/Item` for markers | P2 |

## Known risks / watch list
- Licensing of PUBG map art for a public site (Phase 0).
- Large source PNGs (~90–116 MB each, 8192×8192) → tile build takes ≈ 25 s and < 1 GB RAM locally; still run it locally, not in CI (needs the ≈ 650 MB LFS download). CI uses the committed fixture tiles.
- `Rondo_Main_Low_Res.png` is JPEG-encoded despite `.png` name — handle by magic bytes.
- Next.js rewrites may not proxy websocket upgrades reliably in dev → use direct socket URL fallback.
- Leaflet 2.0 is a breaking rewrite — stay on 1.9.x for v1.

## Bugs
_None yet — log as `- [ ] BUG-<n>: description (found in phase X, repro steps)`._
