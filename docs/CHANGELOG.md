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

### Added
- 2026-11-05 — **Motion library** (UI_UX_SPEC §9.1). Drawing entrances for teammates' new lines / strokes / arrows (trace-in), circles (zone close-in) and polygons (fade), via a short-lived SVG ghost over the canvas (`elementFx.ts`); marker landings (drop: parachute + dust, enemy squad: pop + shake + ring, others: pop); gliding cursors; a third ping ring; a one-shot sync pulse and a reconnecting spinner; a board-switch wipe; a snapshot-restore rewind mark (`fxStore`); and a "Waking the server…" radar card for requests pending over 2.5 s (`slowRequests.ts`). No looping animation while idle; everything is off under `prefers-reduced-motion`. No new dependencies (CSS + Web Animations API).
  - The element renderer keeps a layer when a new version draws identically (a server ack bumping `seq` / timestamps): fewer rebuilds, and entrances aren't cut off.
  - Tests: unit +5 (who gets an entrance, the 12-element cap, hidden layers, marker classes by kind, acks keep the layer); E2E `motion.spec.ts` (B sees A's arrow ghost, A doesn't; markers get their class; reduced motion turns it all off). Playwright now defaults to `reducedMotion: 'reduce'`; the ping fly-to test opts back in for its focus ring.
- 2026-11-05 — **Free deployment: Vercel + Render + Neon + GitHub Pages** (DEPLOYMENT §10, `render.yaml`, SECURITY A11, API_SPEC §2 / §7.1, ENVIRONMENT).
  - **Socket tickets:** `POST /api/v1/auth/socket-ticket` returns a 60 s single-use ticket (256-bit, stored only as a SHA-256 hash in Redis, `GETDEL` on redeem, 60 / min / user). The handshake accepts `auth: { ticket }` when no access cookie arrives; it keeps the Origin check, the revocation check, the 5-socket cap and the session-expiry timer (from the ticket's stored `exp`). The web client sends a fresh ticket on every (re)connect whenever the socket's origin differs from the page's (dev, E2E and Vercel + Render); same-origin (Docker/Caddy) stays cookie-only.
  - **`API_PROXY_URL`** (web, build time): production builds rewrite `/api/*` to the API, so REST and its cookies stay first-party on the Vercel origin. Added to `turbo.json` env.
  - **Redis** connects with `family: 0` (IPv4 + IPv6), for hosts whose private network is IPv6-only (Railway).
  - **`render.yaml`** Blueprint: a free Docker web service (migrations run on start, as free instances have no pre-deploy step) and a free Key Value, both in Singapore.
  - Tests: integration +6 (ticket opens a socket alone, single use, malformed / unknown / non-string tickets, Origin still checked, logged-out session refused, hashed storage + TTL + 401 without a session) and an authz-matrix row; E2E now runs the ticket path (its socket is cross-origin).

### Decisions (deployment)
- Vercel serves only the web app: its serverless functions can't hold the long-lived websockets that live sync needs. Free hosts for the rest: Render (API, Redis), Neon (Postgres; Render's free Postgres is deleted after 30 days), GitHub Pages (tiles; R2 needs a card on file).
- Tickets rather than a shared cookie domain: the free `vercel.app` and `onrender.com` URLs are different sites (public-suffix domains), so no cookie can be shared. Tickets also keep the `__Host-` cookie (no `Domain`) unchanged.
- No keep-alive pinger: `/api/health` touches Postgres, so pinging it every few minutes would keep Neon awake all month and use up its 100 free compute-hours. The ~1 min wake-up is within Vercel's 2-minute origin timeout.
- Verified in a cloud VM: a production web build serving `localhost` with the API on `127.0.0.1`, which the browser treats as different sites. The browser held no cookie for the API host, two users reached **Synced**, and chat crossed the socket. Integration 567/567, E2E 57/57, unit 432/432.

### Changed
- 2026-11-04 — **Premium UI pass** (UI_UX_SPEC §2–3; no behaviour, API or data changes).
  - **Tokens** (`globals.css`, UI_UX_SPEC §2.1 updated): deeper graphite base, a third surface step, `--border-strong`, a 1 px inset top highlight on raised surfaces, an accent gradient (`--accent-hi` → `--accent`) with a soft glow. New utilities: `surface-raised`, `glass` (HUD chrome over the map), `app-backdrop` (faint map grid behind non-map pages). Radius 8 / 12 / 18 px. `section-label` is sentence case now.
  - **Primitives:** accent buttons get the gradient + inset highlight, and disabled accent buttons a neutral fill instead of a half-transparent amber; outline buttons are quieter; inputs, selects and textareas sit recessed with a 3 px focus glow; dialogs blur the page behind them; dropdown menus are glass.
  - **Landing:** full-bleed Erangel hero (`public/landing/hero-erangel.webp`, a 1920×1080 crop of the no-text art) with the real 1.02 km grid letters and a squad plan drawn over it — drop on Pochinki, rotation, zone, enemy squads. One CSS-only animation draws the rotation on load (off with reduced motion); `HeroMap` is pure SVG, no client JS and no map code. A legend under the CTAs names the markers. Features are alternating image/text rows instead of three identical cards; a closing CTA band ("Open a room"). The header floats over the hero.
  - **Brand mark:** a drawn scope reticle (`BrandMark` / `Wordmark` in `SiteChrome.tsx`) replaces the lucide crosshair everywhere.
  - **Auth:** glass card over the map art with the grid on top; larger headings; links in accent.
  - **Dashboard:** sticky blurred header over the grid backdrop; the invite-code panel no longer stretches to the height of the room grid; room cards get a hover lift, a gradient under the map, glass chips, tinted role badges and icon-led facts (online / members / last activity) instead of a dotted string.
  - **Room:** gradient top bar and toolbar, tinted active tab with an amber map icon, gradient active tool, glass HUD / minimap / style bar / long-press menu / follow pill; refined marker and text label pills on the map; an empty-chat state that explains pings; the map's out-of-bounds area matches the page.
  - `/explore` and `/s/[token]` headers span the full width, aligned with their edge-to-edge maps.

### Fixed
- 2026-11-04 — Dashboard: the "Have an invite code?" panel stretched to the full height of the room list (grid `align-items: stretch`).

### Decisions (premium pass)
- Kept the spec's identity (dark HUD, amber, Rajdhani / Inter / JetBrains Mono) and made the map itself the visual signature rather than adding a new palette or typeface — no new dependencies.
- The hero drawing's coordinates are computed from the crop (source x 410–6144, y 1638–4863 of the 8192 px art), so the grid letters are the real Erangel squares (Pochinki sits in M, as in game).
- Second landing CTA is labelled "Open a room": E2E looks up "Create a room" by role and name, which must stay unique.
- `phase9.spec.ts` "never scroll sideways" is marked `test.slow()`: it visits ten pages and took 30–39 s in a cloud VM on both the old and new UI.
- Checked in a cloud VM with the real map tiles (all three maps, every zoom) and screenshots of every screen; unit 432/432, integration 556/556, E2E 55/57 then 50/57 — the failures are the 1 s realtime-sync timing tests, which failed at the same rate on the unchanged UI there (that VM ran Prisma through its WASM query compiler because the native engine download was blocked). Map panning frame time: 17–19 ms new vs 17–24 ms old.

### Docs
- 2026-10-25 — Initial specification pack created: README, PRD, ARCHITECTURE, UI_UX_SPEC, DATABASE_SCHEMA, API_SPEC, SECURITY, TECH_STACK, USER_FLOWS, FEATURES, ENVIRONMENT, TESTING, DEPLOYMENT, CHANGELOG, TODO.
- Verified PUBG `api-assets` map files: high-res art for Erangel (~95 MB), Miramar (~112 MB) and Rondo (~118–122 MB) is stored in Git LFS with labelled (`_Main_`) and unlabelled (`_Main_No_Text_`) variants; low-res variants are 819×819; `Rondo_Main_Low_Res.png` is actually JPEG data. Telemetry names: Erangel `Erangel_Main`/`Baltic_Main`, Miramar `Desert_Main`, Rondo `Neon_Main`.
- 2026-10-26 — Phase 6 spec clarifications. No 6A report with spec problems was found in the repo (6A was uncommitted), so these are the problems found while finishing Phase 6:
  - FEATURES F5: locked = element ops refused for every role, owner included (matches API_SPEC and the server); the panel lists the top-most layer first; layer ops are not undoable in v1; "Clear layer" confirms.
  - FEATURES F6: a "Select details" block (hit priority and tolerance, additive marquee, press-to-select-and-drag, move clamping, inline edit, duplicate offset, viewers pan only); what one undo step is; per-board stacks; redo only what applied.
  - ARCHITECTURE §7.5: before/after steps and the `mySeq` baseline of the seq rule.
  - UI_UX_SPEC §3.5: Measure / Laser disabled until built, layer-row contents, local-hide icon, lock read-only for non-owners. §8: Cmd on macOS, Ctrl+Y everywhere, tools take Enter / Esc / Backspace first, off inside dialogs and menus.
  - TESTING §7: end-of-phase perf claims use an A/B run on the same machine.

- 2026-10-26 — Phase 7 docs: API_SPEC §1.5 / §6 / §7.2–7.3 (`ChatMessage.clientId`, nullable ping board, history and delete semantics, `chat:send` rules, `followers:update`, `chat:typing` not handled); DATABASE_SCHEMA §3.12 (`client_id`, CHECK details, delete semantics); FEATURES F8 (what counts as a manual move, the pill, follower count, summon) and F9 (text rules, optimistic send, unread rule, deleted-board chips, reduced motion); UI_UX_SPEC §3.5 (Chat is the default tab, removable chip, badge placement). FEATURES F5: the "can't be undone yet" warning on Clear layer.

- 2026-10-26 — Phase 8 docs:
  - Phase 7 follow-ups:
    - API_SPEC §7.3 / FEATURES F8 / ARCHITECTURE: `followers:update`, the leader re-sending its view every 1.5 s while followed, summon following at once.
    - FEATURES F9: the unread badge ignores system messages.
    - API_SPEC §7.2: a ping to another room's board or outside the map is `VALIDATION_ERROR`.
    - SECURITY §11 / TESTING §5.3: the E2E "no CSP violation" check only means something once the Phase 10 CSP ships.
  - Phase 8:
    - API_SPEC §3: `GET /api/v1/config`, `POST /auth/resend-verification`, the email routes' 404 when disabled, `DELETE /me { rooms }`.
    - API_SPEC §5: snapshot notes and `board:reset { actorId }`.
    - FEATURES F10–F12: restore steps, auto-snapshot rules, measure behaviour, export contents.
    - DEPLOYMENT: the R2 CORS rule for exports.

- 2026-10-26 — Phase 9 docs:
  - Phase 8 follow-up: FEATURES F5 / F10 and API_SPEC — every `layer:clear` of a non-empty layer takes an auto snapshot (the > 50 threshold is gone); the confirm always says "An automatic snapshot will be saved first."
  - API_SPEC §3 `PATCH /me/prefs` and `Me.prefs`; §8 the demo-boards allow-list and the stripped fields.
  - DATABASE_SCHEMA §3.1 `users.prefs`; §7 how the seed builds the dev data and the demo boards.
  - ENVIRONMENT: `DEMO_BOARD_IDS` (≤ 3), web server-only `ENABLE_DEV_PAGES` and `SECURITY_CONTACT`.
  - FEATURES F13, SECURITY §6 (demo-boards limit) / §13 (security.txt), TECH_STACK (axe, Lighthouse), TESTING §7 (how Lighthouse runs).
  - UI_UX_SPEC §7 / §9 / §10: what each layout offers, long-press, touch targets, the touch empty hint, the element list, the board-actions menu, the contrast fix.
  - DEPLOYMENT: the demo seed in production, the web env, landing screenshots.

- 2026-11-03 — Phase 10A docs: TODO Phase 10 split into 10A / 10B; SECURITY §5 (what T4 now is), §9 (bases, accepted advisory), §11 (ZAP); DEPLOYMENT §2–3 (real images and `deploy/`), §5 (CI jobs, deploy workflow, rollback), §6–7 (backups, restore test, maintenance, metrics), §9 (local rehearsal); API_SPEC §1.4 `MAINTENANCE`, §7.3 `cursor:batch`, §8 `/metrics`; ARCHITECTURE §7.3 cursor batching; ENVIRONMENT (Sentry, maintenance, deploy env files); TECH_STACK (Sentry 11, nodemailer 10, k6 / ZAP / gitleaks); TESTING §5.6–5.7, §7 (k6).
- 2026-11-03 — Phase 9 exit follow-up (decision asked in Decisions (Phase 9)): ARCHITECTURE §4 "Server prefetch" (what is forwarded, the fallback, why `/me` is seeded in the layout) and §6 the 512 px `card.webp`; DEPLOYMENT §4 the per-map image files and adding `card.webp` to an existing bucket.

### Added
- 2026-11-03 — **Phase 12: P2 batch** (TODO Phase 12; FEATURES F3 / F6 / F7, API_SPEC §7.2, DATABASE_SCHEMA §4, SECURITY Z9 / V9, UI_UX_SPEC §3.5 / §10, ARCHITECTURE §6, DEPLOYMENT §4). No new dependencies or services.
  - **Element list for screen readers**: the Phase 9 list (Layers → List) was already built — the backlog entry was stale. It gains a **Location** column (grid ref of the element's anchor; new shared `elementAnchor`) and **Show** for every role, which centres the map through the ping chips' focus request.
  - **Linked own-player markers** (F7): `props.memberId` on `own_player` markers only (schema); the server accepts only a current member of the board's room and strips the id from share-link and demo-board responses. The room feeds a players store (IGN, else display name); linked markers are labelled at render time (element identity kept for everything else, so the renderer's diff is unchanged). Style bar "Linked player" picker, element list reads the name, "Former member" for someone who left.
  - **Curved arrows**: ARROW `props.curved`; one shared Catmull-Rom sampler (`curvePoints` / `drawnPoints`, 16 samples per bend) used by the renderer, the heads, select / eraser hit-testing and thumbnails. "Curved" ∿ toggle for the arrow tool (remembered; never on a two-point arrow) and for selected arrows.
  - **Loot markers with PUBG item icons**: a `loot` marker kind with `props.item` from the shared `LOOT_ITEMS` registry — 80 icons from pubg/api-assets@32b13b5 (`Assets/Icons/Item/**`, `Assets/Icons/CarePackage/*`), in-game names. `packages/map-tiles` fetches them in the same sparse checkout and builds `icons/items/<id>.webp` (64 px, ≈ 125 KB in all) next to the tiles; fixtures add two icons. Markers draw a crate badge and the icon over it (the crate lines are removed once it loads), the crate alone when the icon is missing; Export PNG draws the icon. "Loot item" picker in the style bar (marker tool and selection).
  - Element list layout (found in the review screenshots): the added Location column and Show button made the six-column table overlap at the side panel's width. It is now two columns — element over a muted "location · layer · author" line, then icon actions with descriptive accessible names — and the E2E asserts no horizontal overflow and no overlap.
  - Tests: shared +12, web unit +12, integration +4 (linked / loot / curved ops, public stripping), E2E +4 (`e2e/phase12.spec.ts`).
- 2026-11-03 — **Phase 11: v1.1** (TODO Phase 11; FEATURES F3 / F4 / F4b / F6 / F9 / F11, API_SPEC §5b / §7 / §8, DATABASE_SCHEMA §3.7 / §3.14 / §4, SECURITY Z8 / V8, UI_UX_SPEC §3.5). Built while 10B and Phase 0 wait on hosting and decisions.
  - **Public read-only share links** (backlog P1): `share_links` table (migration `20261103120000_share_links`: one link per board, SHA-256 of a 128-bit token, optional expiry, hex CHECK); `GET` / `POST` (create or regenerate) / `DELETE /boards/:boardId/share` behind the new `board.share` permission (owner / editor); `GET /public/share/:token` — rate-limited 30 / min / IP, `no-store`, `no-referrer`, `noindex`, no room id, author ids or member names, one 404 for every dead link; audit rows `share.create` / `share.regenerate` / `share.revoke`; hourly `expireShareLinks` job; the API's request log masks the token. Web: "Share link…" in the board kebab (dialog: expiry, URL shown once with Copy, Regenerate, two-click Revoke) and `/s/[token]` — the `/explore` read-only map (StaticElements, labels / grid, Measure), no socket.
  - **Board thumbnails** (backlog P1): `PUT /boards/:boardId/thumbnail` (`board.edit`, raw `image/jpeg` ≤ 100 KB, exactly 256×256) — magic bytes, sharp decode with a pixel cap, re-encode (metadata stripped), fresh random key per upload, previous object deleted, `boards.updated_at` untouched. `AssetStorage` (`src/lib/storage.ts`): local disk (`ASSETS_DIR`, served at `GET /api/v1/assets/thumbnails/:boardId/:file`) or R2 / S3 when every `S3_*` + `PUBLIC_ASSETS_BASE_URL` is set (all-or-none at boot); objects also deleted with their board and when a room is purged. `RoomSummary.thumbnailUrl` is now filled. Web: the room session raises local-edit events; 30 s after the user's last edit the room draws a 256 px JPEG from the board model (low-res map + visible layers) and uploads it; dashboard cards use it and fall back to the map card image; the pages' CSP adds the assets origin to `img-src`.
  - **Minimap** (MAP-5, P2): bottom-right, 160×160, collapsible (remembered per device), low-res image + view rectangle; click / drag / arrow keys move the view and count as a manual move for follow mode. Room, `/explore`, `/s/[token]`; not on phones; not in PNG export.
  - **Typing indicator** (P2): `chat:typing` handled — volatile, relayed to the rest of the room ≤ 1 / 2 s per socket, only after `room:join` and while a member; the client throttles its sends and shows "X is typing…" (two names, then "Several people"), cleared after 4 s or when that person's message arrives. `TODO(p2)` removed.
  - **Drawing extras** (P2): ARROW `props.doubleHeaded` (strict); a ⟷ toggle in the style bar for the arrow tool (remembered) and for selected arrows (one undoable batch); the renderer and thumbnails draw both heads. Measure → **Save as line** (Editor+): LINE elements on the active layer with the Line style, N points → N − 1 lines, one undo step.
  - Tests: shared +10 (share schemas, ARROW props, `board.share`), server unit +13 (SigV4 against AWS's published vectors, storage backends, config, re-encode, log masking), integration +53 (share links, thumbnails, typing, double-headed ops, 4 + 2 REST matrix rows × 5 callers, 1 socket matrix row × 4), web unit +22, E2E +6 (`e2e/phase11.spec.ts`). Lighthouse: `LH_THUMBNAILS=1` runs the dashboard with uploaded thumbnails.
- 2026-11-03 — **Phase 10A: hardening, deploy pipeline, load test** (TODO Phase 10A; SECURITY §5 / §8–9 / §11, DEPLOYMENT §2–9, TESTING §5–7). No staging or production server exists yet, so everything below was verified against the production images on local Docker; 10B repeats the server-dependent parts on the real VMs.
  - **CSP with nonces** (SECURITY T4):
    - `src/proxy.ts` now runs on every page: a fresh nonce per request, the CSP on the request (Next stamps the nonce on its scripts) and on the response; the `(app)` login guard is unchanged.
    - `src/lib/csp.ts` builds the policy: `script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-eval'` outside dev, only absolute http(s) tile / socket / Sentry origins added (Next's proxy runtime turns `new URL('/tiles').origin` into the string `"null"` — filtered).
    - Every page renders per request (root layout `connection()`); all routes are now dynamic.
    - Zod runs jitless in browsers (`packages/shared/src/zodSetup.ts`, imported first by the shared index and by `env.ts`): its `new Function` probe was the one CSP violation left.
  - **API headers:** `@fastify/helmet` — deny-all CSP (`default-src 'none'`, `frame-ancestors`, `base-uri`, `form-action`), nosniff, Referrer-Policy, COOP / CORP; HSTS only with `COOKIE_SECURE=true`.
  - **Forms post:** every `<form>` has `method="post"` (20 forms; a unit test keeps it so). ZAP's spider submitted the server-rendered register form before hydration and got `?password=…` in the URL — a real user pressing Enter on a slow connection would have too.
  - **Maintenance mode** (DEPLOYMENT §7): `MAINTENANCE=true` → `503 MAINTENANCE` + `Retry-After` on every route but health and metrics, socket handshakes refused; the web app shows a banner on every page from its own `MAINTENANCE`. New error code `MAINTENANCE`.
  - **Metrics:** `GET /metrics` (prom-client): process defaults, `http_request_duration_seconds{method,route,status}`, `socketio_connected_clients`; `METRICS_TOKEN` → bearer required, otherwise `404`. Per-app registry.
  - **Sentry** (off until a DSN is set): server `@sentry/node` reports unexpected 5xx from the error handler; web `@sentry/nextjs` in `instrumentation-client.ts` (SDK chunk fetched only with a DSN) and `instrumentation.ts` (`onRequestError`). Sentry 11 collects cookies / headers / bodies by default — all turned off via `dataCollection`, plus a `beforeSend` scrub on the server. Releases `rotationlab-{server,web}@<version>`.
  - **Images** (`docker/`, `.dockerignore`): web on Alpine (standalone, per-environment build args, `check:no-debug` in the build); server on Debian slim with the Prisma CLI and `tsx` (migrations and seeds from the same image). Both non-root, healthchecked, run `read_only`.
  - **`deploy/`:** `docker-compose.prod.yml` (no fixed project name — a local run uses `-p rl-prodtest` so the dev volumes are never touched), `Caddyfile` (edge headers, deny-all CSP fallback via `?Content-Security-Policy`, 1 MB request cap, per-connection resolution of `server` so `--scale` works), `env/*.env.example`, `deploy.sh` (migrate → up → smoke → rollback to `.last_tag`), `backup.sh` / `restore.sh` (bash, `pipefail`; the dump goes straight into `age`, never to disk unencrypted), `ci-ssh-deploy.sh`. `.gitignore`: `deploy/env/*.env`, `deploy/backups/`, `deploy/.last_tag`, `loadtest/users.json`.
  - **CI:** `security` job (`pnpm audit --prod --audit-level=high`, gitleaks over the full history) and `images` job (both Dockerfiles build). `zap.yml` nightly against staging (fails on High). `deploy.yml`: staging after a green CI run on `main`, production on `v*` behind the `production` environment; server image re-tagged, web image rebuilt with production build args. actionlint clean apart from one note on an existing job.
  - **Realtime — batched cursors:** the server buffers each board's latest cursor per user and flushes one `cursor:batch { boardId, cursors[] }` every 50 ms (replaces the per-move `cursor:move` broadcast; the client applies a batch in one store update and skips its own cursor). The cursor stream's membership check is reused for 5 s (kicks disconnect at once).
  - **Fewer queries per op:** the socket path resolves board + role once (`boardOps.applyResolved`); `touchRoom` skips its query within a minute of the last touch on this instance; the element lookup no longer joins its layer when the element stays on the layer just checked.
  - **Load test:** `loadtest/realtime.js` (k6 over raw websockets) + `apps/server/scripts/loadtest-seed.ts`. See Decisions (Phase 10) for the runs.
  - **Dependencies:** nodemailer 6 → 10.1.7 (5 high advisories; a mail sent through Mailpit with v10 to check), `pnpm.auditConfig.ignoreGhsas` for deepmerge-ts (SECURITY §9).
  - **Rehearsed on the local production stack** (DEPLOYMENT §9): headers per response type; `__Host-rl_at` / `__Secure-rl_rt` cookie flags; `wss://localhost/realtime` through Caddy; zero CSP violations and console errors across register → room; deploy and **rollback from a broken release** (detected in ~50 s, previous tag restored, exit 1); demo seed from the image; **encrypted backup restored into a scratch database** (1 user / 1 room / 3 boards / 24 elements / 8 migrations); ZAP baseline 0 failures; gitleaks clean (13 commits).
  - Tests:
    - Unit 366 (+16): web `csp.test.ts` (nonce / strict-dynamic, dev eval, CDN + socket + Sentry origins, never `"null"`), `forms.test.ts` (every form posts), `phase10.test.ts` (`MAINTENANCE` parsing, Sentry data collection off); server `phase10.test.ts` (API headers, HSTS only over HTTPS, maintenance 503 with health / metrics up, `/metrics` with and without a token); shared: 21 error codes.
    - Integration 499 (+5): batched cursors (one message per tick, latest position per user), the cursor tests on `cursor:batch`, the volatile cap measured on `laser:point`, the `/metrics` authz row; the harness retries a deadlocked `TRUNCATE`.
    - E2E 47 (+2, `security.spec.ts`): pages carry a fresh nonce CSP that every script uses; register → explore → privacy / terms → room → settings with zero CSP violations. The API-restart test now runs in its own Playwright project after all others — stopping the shared API broke whatever ran beside it.
    - Lighthouse (all pages now dynamic, median of 5, AC power): landing 93, dashboard 89, accessibility 100.
- 2026-11-03 — **Phase 9 exit: dashboard Lighthouse 83 → 91** (TODO Phase 9; the user picked both fixes offered in Decisions (Phase 9), one after the other).
  - **Card image:** the tile build writes `<map>/card.webp` (512 px, WebP q72: Erangel 34 KB, Miramar 52 KB, Rondo 59 KB, vs the 151–228 KB `preview.jpg`). `MapConfig.card` in shared; dashboard room cards use it (`MapThumb variant="card"`); `preview.jpg` stays for the auth backdrop. Fixture tiles regenerated with a `card.webp` per map. Lower WebP quality barely helps (q50 still 39–44 KB for Miramar / Rondo), so q72 stays.
  - **Server-rendered room list:** `app/(app)/dashboard/page.tsx` is now a server component that fetches `GET /rooms` and seeds React Query through a `HydrationBoundary`; the client UI moved to `components/rooms/DashboardView.tsx`. The `(app)` layout seeds `GET /me` the same way, above `AppShell`. `lib/serverApi.ts`: `prefetchApi` (forwards only the access cookie plus `X-Forwarded-For`, 1.5 s timeout, validates with the shared schema, null on anything else → the client fetches as before), `requestContext`, `dehydrated`. Query keys moved to `lib/queryKeys.ts` (no `'use client'`, so server code gets the values; re-exported from the old modules). React hoists the first card's image into a `<head>` preload, so it loads before any JS.
  - The card's "2h ago" has `suppressHydrationWarning` (the server's clock may be on the other side of a minute).
  - `INTERNAL_API_URL` is now read by `serverEnv()` too (it was only used by the dev rewrites).
  - Tests: unit 190 (+8, `serverApi.test.ts`: forwarded headers, no call without a cookie, null on 401 / 500 / bad shape / non-JSON / network error, `dehydrated`); E2E 45 (+2, `dashboard.spec.ts`: the room name and the image preload are in the HTML, hydration without console errors; an invalid access cookie prefetches nothing and still reaches the dashboard through the client refresh).
  - **Lighthouse** (mobile, cold cache, AC power, median of 5, A/B on the same machine):

    | | Phase 9 commit | + card image | + server-rendered list |
    |---|---|---|---|
    | Landing | 94 | 94 | 95 |
    | Dashboard | 79 | 82 | **91** |

    Accessibility 100 on both. Today's Phase 9 baseline (79) is below the recorded 83: run-to-run and day-to-day variance. On battery the same machine measured 67 / 63, so Lighthouse runs need AC power.
- 2026-10-26 — Phase 8 follow-up: `layer:clear` always saves an auto snapshot "Before clearing '{layer}'" when the layer has ≥ 1 element (an empty layer saves nothing and posts no system message). `SNAPSHOT_LIMITS.clearAutoThreshold` is gone; the confirm says "An automatic snapshot will be saved first." for every clear. Integration tests now cover 3 elements and the empty layer; the layers E2E clears a layer and finds the auto snapshot in the drawer.
- 2026-10-26 — **Phase 9: landing, explore, responsive layouts, onboarding, accessibility** (TODO Phase 9; UI_UX_SPEC §3.1 / §3.4 / §7 / §9 / §10, FEATURES F13, USER_FLOWS UF-3 / UF-9, TESTING E2E-12 / 13).
  - **Landing `/`** (server component):
    - Nav with logo, Log in, Get started — "Go to dashboard" when logged in.
    - Hero "Plan your rotations together." with "Create a room" (register, or the dashboard when logged in) and "Explore maps".
    - Three feature cards with static WebP screenshots of the seeded boards.
    - Footer: KRAFTON attribution and the BGMI notice (brand.ts), Privacy, Terms, Security contact.
    - The only client JS is a tiny session check (a plain `fetch('/api/v1/me')`); React Query, sonner and zod are no longer in the root layout, which wraps nothing — `(app)`, `(auth)`, `/explore` and the dev map page bring their own `Providers`.
    - `pnpm --filter web shots` (`scripts/landing-shots.ts`) makes the screenshots against `pnpm dev`; Chromium encodes the WebP itself (`OffscreenCanvas.convertToBlob`), so no image library is involved. Results: 115 / 82 / 101 KB at 960×600.
  - **Privacy / Terms** (`(site)` group): plain placeholders based on SECURITY §7 — what is stored, cookies (httpOnly only), no trackers, retention (30 / 90 days, 7-day room purge, 14-day backups), deletion. Marked `TODO(phase0)` with a visible "not reviewed by a lawyer" note.
  - **`/.well-known/security.txt`**: a route handler with `Contact:` from `SECURITY_CONTACT`, a rolling RFC 9116 `Expires:`, `Canonical:` and the 90-day note; 404 when unset.
  - **Explore `/explore`** (FEATURES F13, UF-9):
    - `GET /api/v1/public/demo-boards`: public, 30 / min / IP, `Cache-Control: public, max-age=300`. Only `DEMO_BOARD_IDS` (≤ 3, env order); deleted rooms skipped; no room ids or author ids. Empty list when unset. In the authz matrix.
    - Read-only page: a map switcher, labels / grid via the map HUD, Measure (R, the room's MeasureTool). No editing tools and no socket. CTA bar "Create a free account to save your own boards". Bare maps (with a note) when no demo board exists.
    - `StaticElements` (shared with the snapshot preview) renders fixed data with the live ElementRenderer.
  - **Seed** `pnpm --filter server seed [--demo-only]`: alice / bob + "Demo Squad" (dev only) and three demo boards (drop, rotation arrow, zone circle, three enemy squads, own squad, a note) in a locked room owned by an account nobody can log in as. Idempotent; prints `DEMO_BOARD_IDS=`. The E2E API supervisor seeds the demo boards and passes their ids to the API.
  - **Dev page gating**: `/maps/[mapId]` is 404 unless `ENABLE_DEV_PAGES` allows it (default: on in development, off in production), checked per request.
  - **Responsive layouts** (UI_UX_SPEC §7; `useBreakpoint`):
    - Compact (1024–1279): the panel starts collapsed (300 px).
    - Tablet (768–1023): the toolbar is a horizontally scrollable bottom bar with every tool; the panel is a half-height bottom sheet opened by a chat button with the unread count; the style bar sits above the toolbar.
    - Phone (< 768): view + chat mode — full-screen map; Select / Marker / Measure / Laser (+ undo / redo for editors); "Use a larger screen for full drawing tools" banner; board dropdown; one top-bar menu (Invite, Members, Chat, Snapshots…, Export PNG, Room settings, Leave); chat as a full-screen sheet (a focus-trapping dialog).
    - Touch: one finger draws, two pan / pinch. **Fixed:** with dragging off, Leaflet's own `touch-action: pan-x pan-y` (loaded after our CSS, same specificity) let the browser take one-finger strokes and cancel them; drawing mode now forces `touch-action: none`. Long-press (Select, 500 ms, ≤ 10 px) on an element selects it and opens Edit label / Delete. Touch targets ≥ 44 px on `pointer: coarse`. Chat message options are always visible on touch.
    - Dashboard, auth, settings, join, explore, privacy and terms fit 360 px with no horizontal scroll.
  - **Onboarding**:
    - First room visit: a 3-step coach-mark tour (toolbar → board tabs → Invite; steps without an anchor are skipped). Next / Back / Skip / Esc, focus on the card and back afterwards, non-modal.
    - Finishing or skipping calls `PATCH /me/prefs { roomTourDone: true }` (new `users.prefs` jsonb, migration `20261026230000_user_prefs`). It never repeats — after a reload, on another device. `Me.prefs` is defaulted in the schema so a client never breaks on an older API.
    - Empty-board hint: "Pick a tool below and start drawing." on touch layouts.
  - **Accessibility** (WCAG 2.2 AA on non-map UI; E2E-13 at 0 serious / critical):
    - Landmarks on every page; the room's tab order is top bar → toolbar → map → panel.
    - Focus ring everywhere: the presence avatars and tab panels no longer suppress it; menu items get an accent bar.
    - Icon buttons labelled.
    - Board tabs: the `tablist` now only owns tabs — the board actions moved to one "⋮" menu for the active board after the tabs.
    - Labelled dots / badges have `role="img"`.
    - The room-card link is named by its content (WCAG 2.5.3 label in name).
    - Auth links are underlined (link-in-text-block).
    - Destructive buttons `#DC2626` (4.8:1).
    - Presence avatars no longer overlap (WCAG 2.2 target size).
    - Toasts are announced (sonner's polite live region).
    - Reduced motion also disables Leaflet's zoom / fade animations and follow mode's glide.
    - **Element list** (P2): Layers tab → List; a table (type, label, layer, author) with Select / Delete.
  - **Performance hygiene**:
    - next/font for the three fonts; JetBrains Mono is no longer preloaded.
    - Leaflet stays out of the landing bundle (E2E-checked).
    - The room preloads its board's low-res placeholder with the room data (React `preload`, same CORS mode as the overlay).
    - AppShell mounts pages while `/me` is in flight, so `/rooms` or the room starts in parallel instead of after it.
    - The first dashboard card's image is `fetchpriority=high`; the others lazy-load.
  - Tests:
    - Shared 111.
    - Server unit 52 (+5): `DEMO_BOARD_IDS` parsing, seed content against the element schemas and map bounds, `readPrefs`.
    - Web unit 182 (+10 after dropping the 4 HealthStatus tests): breakpoints and tool sets per breakpoint / role, the toolbar at phone size, the tour reducer and card placement, `exploreBoards`, `ENABLE_DEV_PAGES`, `security.txt`, element labels.
    - Integration 493 (+17): the demo-boards endpoint (empty when unset, cache header, only listed ids in env order, stripped fields, a non-demo id never served whatever the request says, deleted room dropped, 30 / min then 429, per IP), `PATCH /me/prefs` (defaults, merge, another device, strict body, bad stored JSON), both authz rows.
    - E2E 43 (+9, `phase9.spec.ts`):
      - **E2E-12** (iPhone 13, against a desktop context): layout, the four tools, banner, menu, 44 px targets, the chat sheet sending and receiving, a tapped marker syncing, long-press → delete.
      - **Tablet** (iPad gen 7): every tool in the bottom bar, the half sheet, the style bar above the toolbar, a touch-dragged arrow syncing.
      - **E2E-13**: axe on landing, login, register, privacy, terms, explore, join, room (+ Layers, Members, element list, invite dialog), dashboard and settings.
      - **Keyboard only**: register → create room → tour (Esc) → invite → chat.
      - **Explore**: no login, map switching, measure, no websocket or `/realtime` request.
      - **Tour**: once, not after a reload or in another context.
      - **360 px**: no horizontal scroll.
      - **Landing**: dashboard link when logged in, credits, no Leaflet, `security.txt`.
  - **Lighthouse** (`pnpm --filter web test:lighthouse`, mobile profile, cold cache, median of 3):
    - Landing: Performance 95, Accessibility 100.
    - Dashboard: Performance 83, Accessibility 100 — under the 85 target, see Decisions (Phase 9).
  - **Bundle sizes** (production build, compressed):
    - Landing: ~154 KB of JS in its own `<script>` tags, ≈ the App Router floor (React DOM 72 KB, Next runtime 45 KB, page + chunks ≈ 37 KB; the 112 KB core-js chunk is `noModule` and not fetched by modern browsers). Lighthouse counts 294 KB including the prefetch of linked routes.
    - Dashboard: 268 KB of JS (adds the shared schemas / zod 37 KB, Radix ≈ 31 KB, React Query); fonts 88 KB; the card image 151 KB.
  - **Perf, A/B back to back** (pan 5 s, 1 000 elements, 4 runs each, alternating order): Phase 8 commit avg 16.9 / 16.9 / 16.9 / 17.2 ms; Phase 9 avg 16.9 / 16.8 / 17.2 / 16.9 ms; p95 16.8 ms for both. No regression.
- 2026-10-26 — **Phase 8: snapshots, measure, export, settings, email flows** (TODO Phase 8; FEATURES F10–F12, PRD BOARD-5 / STUDY-1 / STUDY-2 / AUTH-5…8, API_SPEC §3 / §5, DATABASE_SCHEMA §3.11 / §6, UI_UX_SPEC §3.8–3.9, USER_FLOWS UF-11 / 12 / 14).
  - Shared:
    - `schemas/snapshots.ts`: `SNAPSHOT_LIMITS` (name 1–60, 50 manual + 10 auto per board, 5 MB, clear threshold 50), the `{ version: 1, layers, elements }` data schema (≤ 10 layers, ≤ 5 000 elements, every element on one of the snapshot's layers), `buildSnapshotData` / `parseSnapshotData` / `snapshotBytes` (UTF-8 bytes), and the REST schemas.
    - `schemas/account.ts`: `DeleteMeBodySchema` with per-room choices, the email-token, verify, forgot and reset bodies, `EMAIL_TOKEN_TTL_MS` (verify 24 h, reset 30 min) and the public config.
    - `measure.ts`: segments / total in metres and approximate foot / vehicle minutes from `SPEEDS`; `formatMeasure` uses a thin-space thousands separator.
    - `brand.ts`: `MAP_IMAGERY_CREDIT`.
    - `board:reset` now carries `actorId`.
  - Snapshots (server):
    - `snapshots` table and an `audit_logs` table (migration `20261026110646_snapshots_audit`, with CHECKs on the name, the element count, the data size and the audit action).
    - REST: `GET` / `POST /boards/:boardId/snapshots`, `GET /snapshots/:id` (with data), `POST /snapshots/:id/restore`, `DELETE /snapshots/:id` (the author or the room owner). Editors save and restore; viewers list and preview.
    - A manual save beyond 50 is `LIMIT_REACHED`. Auto snapshots prune the oldest beyond 10.
    - Restore runs in one transaction:
      1. lock the board;
      2. auto-snapshot "Before restore of '{name}'";
      3. replace the layers and elements, keeping their ids;
      4. drop `board_ops`;
      5. bump `last_seq` and fix `element_count`;
      6. write the audit row.

      After commit it emits `board:reset { reason: 'snapshot_restore', actorId }` and the system message "{user} restored snapshot '{name}'".
    - `layer:clear` of more than 50 elements first takes an auto snapshot "Before clearing '{layer}'" and posts a system message. Saving a manual snapshot posts one too.
  - Snapshots (web):
    - Drawer from the board-tab kebab (and the ⋯ menu): save (name 1–60), and a list with name, author, time, element count and an "auto" tag.
    - Hover prefetches; clicking opens a read-only preview in a modal map that reuses the ElementLayer renderer.
    - Restore asks for confirmation. Delete only shows to those allowed.
    - On `board:reset` every client resubscribes in full and clears that board's undo / redo stacks, with the toast "Board was restored by {name}".
    - Clear layer's confirm: "An automatic snapshot will be saved first." above 50 elements; the `TODO(phase8)` is gone.
  - **Measure (R)**, for every role:
    - Click points; double-click or Enter finishes; Backspace removes the last point; Esc clears.
    - Labels show each segment and the total with "~N min on foot · ~N min by vehicle (approx.)".
    - Local only, drawn in a neutral white / dark-halo style in its own pane above every layer.
  - **Export PNG** (⋯ menu, Editor and Viewer):
    - An offscreen-canvas composite, no new dependency, of the current viewport at `devicePixelRatio` (max 2×).
    - Draw order: background, loaded tile images of the current variant, the grid and its labels if visible, then the visible layers' vectors, markers and texts.
    - Cursors, selection, HUD, laser, ghosts and the measure line are excluded.
    - A 24 px footer strip "room · board · map · date · PUBG map imagery © KRAFTON".
    - Filename `{room-slug}_{board-slug}_{YYYY-MM-DD}.png`.
    - Tiles and the low-res overlay load with `crossOrigin="anonymous"`, so the canvas isn't tainted.
  - **Settings page `/settings`** (UI_UX_SPEC §3.9):
    - Profile: display name, IGN, avatar colour.
    - Account: read-only email; change password, which revokes the other sessions.
    - Sessions: list with this device marked; log out one, or all others.
    - Danger zone: delete account with password + "DELETE". Each owned room gets a choice (transfer to a member, or delete), and the default is the longest-standing editor.
  - **Account deletion** (`DELETE /me`), in one transaction per DATABASE_SCHEMA §6:
    - Owned rooms are transferred or soft-deleted. Without a choice, the room goes to the longest-standing editor, else it is soft-deleted.
    - Memberships are removed; chat is kept with `author_id = null`.
    - Refresh and email tokens are revoked or deleted.
    - The user is anonymised (`deleted+<id>@invalid`, `deleted_<short>`); audit rows are written.
    - After commit: socket sessions are revoked, policy caches busted, and the client redirects to the landing page.
  - **Email flows** behind `EMAIL_ENABLED` (AUTH-7, SECURITY A9):
    - nodemailer SMTP transport (Mailpit in dev via the compose `email` profile), with an in-memory transport for tests.
    - Templates: plain text plus simple HTML, with every interpolated value escaped.
    - Verify email: sent on register; a banner with "Resend" (3 / h per user).
    - `forgot-password` always returns 202 (10 / h per IP, 3 / h per email). `reset-password` revokes every session.
    - Tokens: 256-bit base64url, stored as SHA-256, single use (atomic consume), purpose-bound; a new token voids the earlier unused ones of that purpose.
    - With the flag off, the routes return 404 and the UI hides the links (`GET /api/v1/config`).
  - **Jobs** (ARCHITECTURE §11), each with a leader lock:
    - `purgeDeletedRooms`: hard delete 7 days after soft delete.
    - `expireInvites`: sets `revoked_at` on expired invites.
    - `cleanupTokens`: refresh / email tokens 30 days after expiry or use, audit rows after 90 days.
  - Zone presets are still empty (`TODO(phase0)`), so the dropdown stays hidden. A unit test injects presets to prove the plumbing.
  - Tests:
    - Shared 111: snapshot (de)serialization and limits; measure maths and formatting.
    - Server unit 47: ownership resolution, the email-token lifecycle with a fake store, template escaping, auto names.
    - Web unit 176:
      - export composition with a mock canvas (layer order, exclusions, footer);
      - measure tool input; the drawer, preview and confirm;
      - board:reset clearing history; injected zone presets; settings defaults.
    - Integration 476 (+76):
      - snapshot CRUD and permissions; restore atomicity with a forced id clash mid-transaction, after which nothing changes;
      - auto pruning; `layer:clear` > 50 → auto snapshot; `board:reset` only after commit;
      - account deletion with transfer, delete and fallback, plus the refusals;
      - verify / reset happy paths and every failure (expired, reused, wrong purpose, disabled → 404); forgot-password not enumerating; the purge, invite-expiry and cleanup jobs.
      - The authz matrix has every new route.
    - E2E (`phase8.spec.ts`), all 34 passing on the production build:
      - **E2E-7** save → modify → restore: both contexts equal the snapshot and the undo stacks are cleared.
      - **E2E-11** the PNG downloads, is non-empty, has dimensions = viewport × DPR, and has the footer.
      - Measure across the map.
      - Settings: IGN change; a password change logs out the other context.
      - Delete account with the room transferred to the other user, who then sees themselves as owner.
  - **Perf, A/B back to back** (pan 5 s, 1 000 elements, 4 runs each, alternating order): Phase 7 commit avg 19.3 / 19.9 / 19.3 / 20.2 ms; Phase 8 avg 21.2 / 21.5 / 19.6 / 19.9 ms; p95 33.4 ms for both. In reverse order the gap disappears, so there is no regression. Absolute numbers are higher than Phase 7's recorded run because the machine was more loaded.
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

- 2026-10-25 — **Phase 5A: realtime core, server side** (TODO Phase 5; RT-1, RT-3, RT-5, RT-6 server half, RT-7; SECURITY Z1, Z4, Z5, T2, §6):
  - Schema: `elements` (+ `ElementType` enum), `board_ops` (PK board_id+seq), `room_bans`. Migrations `realtime_bans` + `realtime_checks`, with CHECKs for geometry/style/props size, seq ≥ 0, op kind, and ban ≠ self.
  - Shared:
    - `schemas/elements.ts`: discriminated union per element type with the SECURITY V2 limits, `elementWithinWorld` against the board's map size, `LayerInput`.
    - `realtime.ts`: every API_SPEC §7.2/7.3 event as a Zod schema, typed `ClientToServerEvents` / `ServerToClientEvents`, ack types, `BoardOp`, `Presence` + 12 presence colours.
  - Socket.IO 4.8 on the Fastify HTTP server: `/realtime`, websocket-only, `maxHttpBufferSize` 64 KB, perMessageDeflate. Redis adapter on duplicated ioredis clients.
    - Handshake: Origin = `APP_ORIGIN`, access cookie (`__Host-rl_at` in prod), JWT + revoked-sid check, ≤ 5 sockets per user (counted cluster-wide). `connect_error.data.code` is `UNAUTHENTICATED` / `TOKEN_EXPIRED` / `FORBIDDEN` / `LIMIT_REACHED`.
  - Handlers, each with an ack (`{ ok, data } | { ok:false, code, message }`), Zod validation, and a role re-check through the Redis-cached room policy on every event:
    - rooms & presence: `room:join` / `room:leave`; presence as a Redis hash per room (field per socket, 60 s TTL, heartbeat, tabs counted once, idle = idle in every tab, unique colour among online users) with `presence:update` broadcasts;
    - boards: `board:subscribe` (leaves the previous board; delta from `board_ops` when contiguous, else a full snapshot read at REPEATABLE READ);
    - durable ops: `element:upsert/delete/batch` and `layer:upsert/delete/reorder/clear`;
    - follow & summon: `follow:start/stop`, `summon` (OWNER/EDITOR);
    - volatile: `cursor:move`, `stroke:preview` (drawers only), `laser:point`, `view:update` (followers only).
  - Board-ops service: one transaction per message — row-lock the board, consecutive seqs, apply, write `board_ops`, keep `element_count` exact (5 000 cap), all-or-nothing batches, locked layers rejected, ≤ 10 layers, never the last layer. Last-writer-wins by seq. opId dedupe per user in Redis (10 min) returns the original seqs without re-applying or re-broadcasting.
  - Per-socket token buckets: durable 30/s burst 60, chat 5/10 s, volatile 40/s combined (silently dropped). 10 durable/chat violations in a minute → disconnect.
  - REST → realtime bridge for every Phase 4 event, across instances via the adapter:
    - board created / updated / deleted (subscribers leave the deleted board's channel);
    - member joined / left / roleChanged; room updated / deleted;
    - **kick**: `member:kicked` to the target, then its sockets for that room are disconnected;
    - logout, logout-all, password change, session revoke and refresh theft disconnect those sessions' sockets.
  - Board duplicate now copies elements (new ids, layer mapping) in the same transaction. `GET /boards/:id/state` returns elements.
  - Jobs: node-cron prune of `board_ops` (older than 24 h, or beyond the last 1 000 per board) every 15 min, on a single leader via a Redis lock.
  - `scripts/realtime-smoke.ts`: two clients against `pnpm dev`, draws 100 elements, prints latency. **Measured on loopback against the dev server: ack round trip p50 27.3 ms / p95 40.4 ms / max 58.3 ms; broadcast to the second client p50 27.3 ms / p95 40.4 ms.**
  - Tests: 361 integration tests in total:
    - realtime: 38 (every TESTING §4 realtime row, plus locked layers, geometry/bounds, 5 000 cap, batch atomicity, layer ops, presence, follow/summon, volatile cap, role downgrade, logout disconnects, board events, **two server instances sharing Redis**, duplicate-with-elements, prune job, leader lock);
    - **socket authz matrix**: 18 events × 5 callers (74 cells; anonymous callers get no socket at all);
    - kick + block and `primaryMapId` tests;
    - REST authz matrix now 35 routes.
- 2026-10-25 — **Phase 5B: realtime core, client side** (TODO Phase 5; RT-1…RT-7 client half, COLLAB cursors/presence; SECURITY V4/V5):
  - `lib/realtime/socket.ts` + `connection.ts`: typed Socket.IO singleton (websocket only, `withCredentials`), jittered backoff 0.5–10 s, refresh on `TOKEN_EXPIRED` (handshake or server-side), proactive refresh 60 s before expiry with a silent reconnect (status never leaves "connected"), session-expired modal that keeps unsent ops.
  - `stores/boardModel.ts` + `boardStore.ts` (Zustand + immer): confirmed state + pending overlay keyed by opId, per-item seq rule with delete tombstones, ack/reject (rollback), contiguous `lastSeq` with gap detection → delta resync after 2 s, full/delta subscribe, resend of pending ops with the same opIds, offline queue capped at 500 ops, `board:reset`, memoised per-id view.
  - `RoomSession`: join → subscribe(`sinceSeq`) → flush on every (re)connect; consecutive element ops batched into `element:batch` (≤ 50 ops / 60 KB); retry on CONFLICT / RATE_LIMITED / INTERNAL; room events update the React Query cache (kick / room deleted / role change / boards / members).
  - `presenceStore`: heartbeat every 20 s, idle after 2 min; sync indicator (synced / syncing / offline / reconnecting), presence avatars (5 + N) with colour rings, presence dots on board tabs, live cursors at 20 Hz fading after 5 s.
  - `ElementLayer` on a shared `L.canvas` renderer: identity-diffed updates, visibility and restack only where needed; markers and text built with `createElement`/`textContent` and `#RRGGBB`-checked colours (never HTML).
  - Dev/E2E-only `window.__rlDebug` (`addRandomElements`, `moveElement`, `deleteAll`, …), stripped from production builds and checked in CI (`check:no-debug`).
  - Tests: web unit 74 (store rules incl. the remote-higher-seq-while-pending edge case, socket refresh flow with a fake socket, renderer diffing + marker DOM safety); E2E realtime (two contexts): 20 elements synced < 1 s + a move, presence + cursors, offline queue, API kill/restart mid-session (supervisor `scripts/e2e-api.ts`), kick; perf benchmark.
  - **Perf (headless Chromium, software rendering), pan 5 s:** empty board 319 frames · avg 16.7 ms · p95 16.7 ms; **1 000 mixed elements 275 frames · avg 18.6 ms · p95 33.3 ms · max 50.0 ms.**
  - Smoke script rerun: ack and broadcast p50 21.1 ms / p95 27.1 ms / max 45.6 ms.
- 2026-10-26 — **Phase 7: chat, map pings, laser, follow & summon** (TODO Phase 7; CHAT-1…6, RT-5, FEATURES F8/F9, API_SPEC §6–7, DATABASE_SCHEMA §3.12, SECURITY §4/§6):
  - Schema: `chat_messages` + `ChatKind` enum, migration `chat`:
    - UUIDv7 ids from app code (`gen_random_uuid()` fallback); index `(room_id, id DESC)`;
    - CHECKs: body 1–500 chars; ping x/y within 0–1 000 000; ping fields all null or x/y set (the board may later be nulled); SYSTEM rows have no author and no client id;
    - `client_id` with UNIQUE `(author_id, client_id)` for durable `chat:send` dedupe.
  - Shared: `schemas/chat.ts` (`ChatMessage`, `ChatBodySchema`, `PingInputSchema`, `pingWithinWorld`, history query / response, `DELETED_BODY`); `chat:send` and `chat:message` are now typed; new `followers:update` event.
  - Server:
    - Chat service: send with ping validation (board in this room, point inside that map) and replay on a known `clientId`; list newest first with a cursor (50, max 100); delete by author or owner, which overwrites the body and drops the ping; system messages.
    - System messages for join, leave, kick, role change and board created / deleted, from the existing domain events (`board:deleted` now carries the name). Snapshot ones are `TODO(phase8)`.
    - Socket `chat:send` (`chat` bucket 5 / 10 s → `RATE_LIMITED`; `room.interact`, so viewers chat too). Broadcasts `chat:message` / `chat:deleted` to the room.
    - Leaders get `followers:update { count }` on follow start / stop, a follower disconnecting, and their own `room:join`.
    - REST `GET /rooms/:roomId/messages`, `DELETE /messages/:messageId`. Chat bodies are never logged (log-grep test).
  - Web:
    - **Chat tab** (now the default tab):
      - grouped messages (same author within 2 min), system lines, presence-coloured names, times;
      - infinite scroll up with a stable scroll position, and "Jump to latest" when scrolled up;
      - optimistic send with Sending… / failed + Retry / discard;
      - Enter / Shift+Enter, counter after 400, `/` focuses the input;
      - hover menu to delete (own; owner: any), "message deleted" placeholder;
      - throttled `aria-live` announcements; everything rendered as text nodes.
    - **Unread badge** on the Chat tab, or on the panel toggle while the panel is closed.
    - **Pings**:
      - 📍 pick mode (crosshair, Esc cancels) or Alt+click anywhere attaches a removable chip `📍 {gridRef} · {board}`;
      - a chip switches board, flies there (300 ms) and plays a 3-pulse ring; a deleted board's chip is disabled;
      - a sent ping pulses 3 s for everyone on that board;
      - reduced motion: instant jump, still ring.
    - **Laser (K)**, for every role: hold to emit `laser:point` (≤ 30 Hz). A canvas overlay draws fading 1.5 s trails in the sender's presence colour. Cursor broadcasts pause while lasering (both share the 40/s volatile budget), and receivers move the sender's cursor with the laser.
    - **Follow & summon**:
      - the avatar menu offers Follow / Go to their board, and for yourself Summon everyone (Editor+);
      - the follower mirrors the leader's board, center and zoom with 200 ms smoothing; the leader sends `view:update` (≤ 10 Hz) only while followed, plus once whenever a follower joins or the leader's new board is subscribed;
      - manual pan / zoom stops following ("Stopped following"); a "Following {name} · Stop" pill is shown, and the follower's cursor is hidden;
      - summon toast with "Don't follow" (5 s); followers stop with a toast when the leader leaves;
      - a reconnecting follower re-follows.
    - MapCanvas exposes `data-center` / `data-zoom` (world units) on the map element.
  - Tests:
    - Shared 105 (chat text normalization and limits, ping shape / bounds, history query).
    - Web unit 166 (+16): grouping, merge / pending / retry, unread counting, ping labels, follow reducer (start, manual move, leader gone, silent stop), laser expiry and fade.
    - Integration 400 (+31):
      - `chat:send`: cleaning, limits, dedupe, the 6th message → `RATE_LIMITED`, join-first;
      - pings: another room's board rejected, outside the map rejected, deleted board → `boardId: null`;
      - pagination order and cursor, delete permissions, system messages on join / leave / kick / role change / board create / delete;
      - an XSS payload stored and returned verbatim; no bodies in logs; follower counts and summon.
    - Both authz matrices have the new rows: REST `GET …/messages`, `DELETE /messages/:id`; socket `chat:send`.
    - E2E `chat.spec.ts` (two contexts): send / newline / counter / delete / `/`; the `<img onerror>` payload rendered literally with no element, no dialog and no CSP console message; unread badge; **E2E-4** across boards (center within 50 m, pulse visible) + Alt+click; laser seen by B and gone after 1.5 s, never persisted; summon → follow to another board and its pans → manual pan stops it; follow from the avatar menu and the leader leaving. **E2E-6** now also checks the room is gone from the dashboard and the kick system message.
  - **Perf, A/B back to back** (pan 5 s, 1 000 elements): Phase 6 commit avg 17.0 ms · p95 16.8 ms; Phase 7 avg 17.2 ms · p95 16.8 ms. No regression.
- 2026-10-26 — Phase 6 follow-ups:
  - "Clear layer" confirm now says "This can't be undone yet." (Phase 8 adds the auto-snapshot).
  - `pnpm check:deps` (`scripts/check-deps.mjs`, no new dependency): fails when a workspace imports a package its package.json doesn't declare. Runtime `src/` may use only its own deps; tests, scripts and configs may also use the root devDependencies. It runs in CI and in lint-staged, and a mutation check (dropping `jose`) makes it fail.
  - CI job `fresh-clone-boot`: no pnpm cache, `pnpm install --frozen-lockfile`, builds the API, migrates fresh Postgres / Redis service containers, and boots `node apps/server/dist/index.js` in production mode until `/api/health` is ok.
- 2026-10-26 — **Phase 6: drawing tools** (TODO Phase 6; DRAW-1…9, BOARD-4; FEATURES F5/F6/F7, UI_UX_SPEC §3.5/§6/§8, ARCHITECTURE §7.5). 6A (tools) was found uncommitted and not wired into the room, so it was finished here together with 6B.
  - Shared:
    - `geometry.ts`: boxes, point/segment/polyline distances, point-in-polygon, `hitTest`, circle helpers, 15° snap, `clampToWorld` (6A); `unionBBox`, `bboxFromCorners`, `anchorBBox`, `clampTranslation`, `translateGeometry`, `sweepPoints` (6B).
    - `drawing.ts`: palette, marker default colours, stroke widths. `zones.ts`: per-map zone presets, shipped empty (`TODO(phase0)`), which hides the dropdown.
  - Tools (`components/tools`), all as state machines over integer world units:
    - Pen (≥ 4 px sampling, simplify-js at 1.5 px, 2 000-point auto-split), Line (Shift = 15°), Arrow (clicks + Enter / double-click, or press-drag-release), Circle (radius label in m, Shift = from the edge, presets), Polygon (close on the first vertex / Enter, Backspace removes the last vertex), Text (inline input), Marker (flyout, remembered kind, auto-number: enemy 1–25, own player 1–4).
    - `stroke:preview` at 20 Hz in ≤ 200-point chunks; other users' ghosts at 50 % in their presence colour, expiring after 3 s.
    - **Select (V)**: topmost hit by layer order, then z; Shift+click toggles; click on empty map clears; plain drag on empty map pans (Leaflet); Shift+drag = additive marquee by bounding box; dragging moves the whole selection, previewed locally and committed once on release; radius handle on circles; double-click edits a text / marker label inline. Selection outline: 1.5 px dashed in your presence colour with handles.
    - **Eraser (E)**: click deletes the topmost element; a drag deletes everything the path touches (sampled ≤ 6 px apart, so fast drags don't skip), highlighted during the drag, one batch on release. Hover shows what a click would erase.
    - Both ignore hidden and locked layers, and tell the user once per layer that it is locked.
  - Toolbar (UI_UX_SPEC §3.5): per-role tools (viewers: Select, Measure, Laser — the last two disabled until Phases 8 / 7), marker picker flyout, Undo / Redo disabled while empty.
  - Style bar:
    - With a drawing tool: palette + custom colour, S/M/L width, dashed, fill 0–60 % (closed shapes), text size, marker label, zone presets; the last style is remembered per tool.
    - With a selection: edits the selected elements (colour, width, dashed, fill, label / text, one batch per change), plus Delete and "Move to layer ▾". Viewers get the "View only" banner instead.
  - **Undo / redo** (ARCHITECTURE §7.5):
    - Per board, 100 steps, session-only, in `boardStore`. A step stores before/after per element; undo and redo go out as normal ops with new opIds.
    - Seq rule: an element someone else changed since is skipped with the toast "Changed by {name}", and the rest of the step applies. A new action clears redo; a rejected op leaves the history.
  - **Bulk ops** (FEATURES F6): `RoomSession.sendMany` is all-or-nothing and sends ≤ 50-op `element:batch` chunks (`planSends`). Offline, an action larger than the queue's remaining room is refused whole with "Too many changes while offline — reconnect first"; online it may briefly exceed the 500 cap.
  - **Layers panel** (UI_UX_SPEC §3.5):
    - Rows list the top-most layer first: drag handle (reorder → `layer:reorder`), colour dot, name + element count, eye, lock, kebab (rename / colour / clear layer / delete). Add layer (≤ 10); never the last layer.
    - Clicking a row makes it the active layer (local). The eye sets board-wide visibility (Editor+); Alt+click hides a layer only for you (closed-eye icon).
    - Lock is a button for the owner and a read-only icon for everyone else. Delete and Clear confirm with the element count. The auto-snapshot before a clear stays `TODO(phase8)`.
  - **Shortcuts** (UI_UX_SPEC §8):
    - One resolver (`lib/shortcuts.ts`) covers tools, Ctrl/Cmd+Z / Shift+Z / Ctrl+Y, Delete / Backspace, Ctrl/Cmd+D (duplicate +2 000 cm), Ctrl/Cmd+A (active layer), Esc, Enter, Space-hold pan, 1–9, Shift+G, N, `/` (no-op until Phase 7) and `]`. `?` opens the help dialog built from the same table.
    - Shortcuts are off while focus is in an input, a dialog or a menu; macOS uses Cmd.
  - Empty-board hint (UI_UX_SPEC §9). The map's cursor broadcast now uses pointer events, so it keeps streaming while a tool owns a drag.
  - Dev/E2E debug hook: `elements()`, `layers()`, `selection()`, `history()`, raw `emit()` (to prove the server rejects what the UI hides).
  - Tests:
    - Shared 98 (+ selection geometry); web unit 150 (+76): every drawing tool's pointer sequences, preview throttling, gating, hit priority, marquee, move batching, eraser sweep, duplicate offsets, every undo / redo case incl. the seq-skip toast, redo clearing, rejects and the bulk-op rule, ≤ 50-op chunking, shortcuts incl. focused inputs and macOS, layer panel permissions.
    - E2E `drawing.spec.ts` (two contexts, real mouse + keyboard): **E2E-3** (arrow, circle, enemy marker < 1 s; B moves the marker), select + move + undo / redo for both, "Changed by" on a remotely changed element, eraser sweep of 3, **E2E-9** (lock: no select / erase / draw, read-only lock icon, server refuses a crafted delete), layer reorder + visibility sync + Alt+click local hide + add / delete, Ctrl+A / Ctrl+D / Delete / `?` / typing in a field, **E2E-5** (viewer: 3 tools, crafted `element:upsert` → `FORBIDDEN`), **E2E-8** with tools (3 shapes offline → exactly 3), ghosts + double-click text edit.
  - **Perf, A/B on the same machine back to back** (headless Chromium, software rendering, pan 5 s): Phase 5B code: empty 23.3 ms, 1 000 elements avg 29.5 ms · p95 50.0 ms. Phase 6: empty 20.9 ms, 1 000 elements avg 20.5 ms · p95 33.4 ms. No regression. Those runs were made while every new DB connection cost ≈ 2 s (see Fixed: `localhost` → `127.0.0.1`). With that fixed, two full `pnpm test:e2e` runs gave empty 16.7 ms, 1 000 elements **17.3 / 16.9 ms** avg (p95 16.8 ms), against the recorded 5B baseline of 18.6 ms.
- 2026-10-25 — Phase 5A follow-ups:
  - Layer lock/unlock and edits to a locked layer are OWNER-only (`layer.lock` permission); editors still create / rename / recolour / reorder / delete unlocked layers. SECURITY §3, API_SPEC, both authz matrices updated.
  - Socket session expiry: the server records the token `exp` per socket, emits `session { expiresAt }`, and disconnects with `TOKEN_EXPIRED` `SOCKET_TOKEN_GRACE_SEC` (60 s) after it — one timer per socket, cleared on disconnect. Integration-tested.
  - API_SPEC records the 5A decisions (join before subscribe, one broadcast per batch op, idempotent delete, batch op shape, summon → `board.edit`).
  - Server: acked socket handlers run through a per-socket queue (emit order preserved); `element:batch` dedupes per op so a resend of a partially applied batch replays known ops and applies only the rest.
- 2026-10-25 — Phase 4 follow-ups:
  - FEATURES F2 / API_SPEC now say an invite's role is fixed at creation.
  - **Kick + block**: `room_bans`, `DELETE …/members/:userId { ban?: true }`, `GET /rooms/:roomId/bans`, `DELETE /rooms/:roomId/bans/:userId`, invite accept → generic 403 for banned users. UI: "Also block them from rejoining" in the kick dialog; Room settings → Security → Blocked users with Unban.
  - `RoomSummary.primaryMapId` (map of the most recently updated board); dashboard cards show that map's preview.
  - `pnpm test:e2e` now runs against a production build on its own ports (web :3200 with an E2E-only `/api` + `/realtime` proxy baked in, own `.next-e2e` dist dir; API :4200 without watch mode). `pnpm test:e2e:dev` reuses `pnpm dev`. CI uses the production mode too.

### Decisions (Phase 12)
- **Scope** (asked): the P2 batch that needs no new services. For the icon item I checked what PUBG's repo actually has: `Assets/Vehicle` is 38 photo-style renders at 5760×3240 (unreadable at 28 px), so real icons exist only for items and care packages — you chose **PUBG item icons** for a new loot marker over drawing our own vehicle glyphs. Vehicle markers keep their current glyph.
- **Licensing:** the 80 icons come from the same repo and commit as the map art and fall under the same open Phase 0 review (`TODO(phase0)` in `loot.ts`). The attribution text in `brand.ts` (`PUBG map imagery © KRAFTON`) is a Phase 0 placeholder and was left as is — it should mention the item icons when Phase 0 writes the final text.
- **Icons ship with the tiles, not in the repo**: built by `map-tiles` and synced to the tiles bucket like the map art (same CORS rule, so Export PNG can draw them). Only two solid-colour fixtures are committed; the rest are missing in tests on purpose so the crate fallback is exercised. `map-tiles` now depends on `@rotationlab/shared` (workspace) for the registry — no third-party dependency.
- **Item = allow-listed id**: `props.item` is validated against `LOOT_ITEMS` on both ends and the client builds the URL from the matched entry; no element carries a path or URL (SECURITY V9). Weapons keep their ~3.5:1 shape inside the 64 px square: small at 24 px, but recognisable (checked with the real icons).
- **Linked players: label resolved, never stored.** Linking removes any typed label; the marker shows the member's IGN (else display name) from the room's member list, so it follows renames when that list refreshes (there is no profile-change broadcast). Anonymous views (share links, explore) get neither the id nor a name — "P{n}" only (SECURITY Z9). A link to someone who left stays (no label, "Former member" in the picker) rather than being rewritten by the server.
- **Curved arrows** use a uniform Catmull-Rom spline so the curve passes through every point the user clicked; the stored geometry is unchanged (same limits, same bbox / world checks on the stored points). A two-point arrow is never marked curved.
- **Element list "Show" works for viewers** (looking is `room.view`); Select / Delete keep the map's rules (viewers can't select, F6).
- A/B frame time (1 000 elements, same VM, alternating order, 4 rounds each): `main` avg 21.5 / 22.9 / 22.0 / 24.7 ms, branch 22.8 / 24.4 / 21.8 / 22.8 ms, p95 33.4 ms throughout — no regression (the first two rounds favoured whichever ran first).
- The VM was restarted mid-phase (Postgres / Redis stopped; data, env files and the Playwright browser links survived) — services restarted, nothing else changed.

### Decisions (Phase 11)
- **Share links: one per board, URL shown once.** The token is stored only as SHA-256 (as asked), so the dialog can't show an existing link again; it says a link is active and offers Regenerate. One link per board keeps "revoke" unambiguous. Viewers can't manage links (`board.share` = owner / editor, a new permission in the shared matrix). A link survives its creator being kicked — it belongs to the board, and any owner / editor can revoke it.
- **Share-link expiries** `24h` / `7d` (UI default) / `30d` / `never`. The public read returns the current state with `no-store`, so revoke / regenerate bite at once; it is rate-limited like the demo boards (30 / min / IP). The board **name** is shown (it's the plan's title); the room name, member names and every id but the board's are not. The API log masks `/public/share/<token>`.
- **No AWS SDK.** R2 / S3 is two calls (PUT, DELETE), so `src/lib/storage.ts` signs them with ~60 lines of SigV4 over `fetch`, tested against AWS's documented GET / PUT signatures, instead of adding `@aws-sdk/client-s3` (not in TECH_STACK; I'd have had to ask). `sharp` on the server was named in the Phase 11 brief and is the same 0.35.5 already resolved for `map-tiles` (lockfile: one importer line).
- **Thumbnail keys are random per upload** (`thumbnails/<boardId>/<128-bit>.jpg`): immutable caching without stale images, and a key can't be derived from a board id (which a share link reveals). Served publicly like the tiles — the URL is the secret. The swap doesn't touch `boards.updated_at`, which drives tab and card order.
- **Thumbnails are drawn from the board model, not captured from the live map** (the export path): the fit view regardless of where the user panned, no dependency on loaded tiles, ~15–30 KB. Markers are dots and text is left out at 256 px. Only the user's **own** edits arm the 30 s timer; leaving the board earlier cancels it (no upload on unload). The card shows the thumbnail of the board that `primaryMapId` already uses, so image and map label agree.
- **Production needs R2 for thumbnails**: the server container's root FS is read-only, so without `S3_*` uploads would fail; the server logs a warning at boot rather than refusing to start (the local production rehearsal and k6 runs don't need it). Added to DEPLOYMENT §4 / ENVIRONMENT; the bucket belongs to 10B's provisioning.
- **Save as line → N − 1 LINE elements.** A LINE has exactly two points (DATABASE_SCHEMA §4); rather than change that or store a STROKE, a multi-point measure becomes one line per segment, committed as one action so one undo removes them. Style = the Line tool's remembered style.
- **Double-headed lives in `props`, not `style`**: it only applies to arrows, and `StyleSchema` is shared by every type. Old arrows (`props: {}`) are unchanged.
- **Typing indicator throttle is enforced on both ends** (client ≤ 1 / 2 s; the server drops extras per socket, inside the existing 40 / s volatile bucket). It is not an aria-live region — it would chatter; the message itself is announced.
- Minimap: the low-res art spans the world square like MapCanvas's placeholder overlay. Leaflet's `getNorth()` is the *larger* y in this CRS, so the view rectangle takes min / max instead of trusting the names.
- **A/B results (same VM, back to back):** frame time with 1 000 elements, avg — `main` 25.8 / 22.0 ms, branch 23.4 / 24.3 ms (p95 33.4 ms in all four runs): no regression. Dashboard Lighthouse (mobile, median of 3, fixture tiles copied into `public/tiles`): `main` 89, branch 93, branch with uploaded thumbnails 90; landing 91 throughout; accessibility 100. Realtime smoke against `pnpm dev`: broadcast p50 18.5 ms / p95 23.8 ms.
- **gitleaks allowlist** (found by the PR's CI, chosen by the user): the SigV4 test uses AWS's published example key pair and a web test assigns a made-up share token to `TOKEN`; the full-history scan flagged one of them. `.gitleaks.toml` extends the defaults and allowlists exactly those values, only in `test/*.test.ts` files (editing the files can't fix a history scan).
- **This VM:** Docker Hub answered 429 and postgresql.org is blocked by the egress proxy, so the checks ran on the preinstalled PostgreSQL **16** (TECH_STACK allows 16 or 17) and Redis 7.0 with the compose credentials; Playwright 1.64.1 wants Chromium build 1248 and the VM has 1243, aliased through `PLAYWRIGHT_BROWSERS_PATH` symlinks. Nothing in the repo was changed for the environment.

### Decisions (Phase 10)
- **Phase 10 split** (asked): 10A in the repo + local rehearsal, 10B on the real VMs. `v1.0.0` is held until Phase 0 is closed (asked); the release section will be written then.
- **Web Sentry** (asked): `@sentry/nextjs` added (TECH_STACK). Its host is added to `connect-src` only when a DSN is configured.
- **nodemailer 10** (asked) instead of allowlisting 6.x; **deepmerge-ts allowlisted** (asked) — only Prisma 6's config loader reaches it.
- **Server image on Debian slim, not Alpine.** k6 against the production images, 200 users without cursors: Alpine handled ≈ 217 ops/s of the 400 sent (p95 39.8 s, server 583 % CPU, almost all in Prisma's tokio threads); glibc handled all of it at p95 73 ms and 261 % CPU. Prisma's engine on musl is the known culprit. The web image has no Prisma and stays on Alpine.
- **Cursor batching** (asked — protocol change). With cursors on, the per-move fan-out (one socket write per cursor per teammate, ~40 k/s at 500 users) saturated the event loop: 150 users p95 14.7 s → **209 ms** after batching, 0 errors.
- **Load-test results (local, k6 on the same machine):**

  | Run (cursors 20 Hz unless noted) | p95 broadcast | op errors |
  |---|---|---|
  | 50 users, 60 s, Alpine | 80 ms | 0 / 5 950 |
  | 200 users, no cursors, 90 s — Alpine → glibc | 39.8 s → 73 ms | 0 |
  | 150 users, 60 s — per-move → batched cursors | 14.7 s → 209 ms | 0 |
  | **150 users, 10 min, batched** | **418 ms** (median 32, p90 166) | **0 / 179 850** |
  | 300 users, 60 s, batched (1 or 2 server replicas) | 28.6 s / 22 s | 0 |

  Above ≈ 150–200 users the host is the limit: CPU at 84 %, k6 itself 2–2.5 cores, two servers ~3.5, Caddy ~1.2, Postgres ~0.9 — a second replica barely helped. The 500-user gate (TESTING §7) therefore moves to 10B with k6 on a separate machine; `--scale server=2` is ready (Caddy resolves `server` per connection, Socket.IO is websocket-only, the Redis adapter fans out).
- Two measurement traps worth keeping: (1) a server keeps applying ops it already received after the clients leave — after the first 500-user run it sat at 660 % CPU with nobody connected, so every run now restarts it first; (2) k6 thresholds pass on zero samples, so the script requires `ops_received > 0` and all checks green.
- **Caddy upstream:** `dynamic a` was tried for replicas and reverted — it cached the server's old IP for a minute after a restart and every connection failed meanwhile. The plain upstream resolves per connection and Docker's DNS rotates replicas.
- **ZAP accepted warnings** (`.zap/rules.tsv`): `style-src 'unsafe-inline'` (Leaflet / Radix, already in T4), anti-CSRF tokens (false positive: header + Origin + SameSite), public cache on `security.txt`, COEP (would need CORP on R2 tiles), non-storable pages, "modern web app", the empty-body 307 to `/login`. Scanners on a dotless `localhost` send no SNI, which Caddy's internal-CA policy rejects — the rehearsal scans `rl.localhost`.
- **Maintenance banner** reads the web container's own `MAINTENANCE` (server-only env, per request) rather than reacting to the first 503: it shows on every page, the landing included, without an API call.
- **Load-test fixtures** are minted server-side (users, rooms, tokens) rather than registered through the API: production allows 5 registrations / hour / IP, and lowering the limit for a test would test something else.
- The integration harness retries `TRUNCATE` on a Postgres deadlock (40P01): socket ops a test sent are still being applied when the next test starts. Faster op handling exposed it.

### Decisions (Phase 9)
- **Lighthouse target missed on the dashboard** (83 vs 85; landing 95). The LCP element is the first room card's 1024 px, 151 KB `preview.jpg` shown at 378 px. Under simulated slow 4G it can only start after the JS (268 KB), `/me` + `/rooms` and the image itself, because the list is client-rendered. Fixed what was legitimately wrong:
  - the AppShell waterfall;
  - `fetchpriority`;
  - an unneeded font preload.

  I did not lower the threshold or hide the image. The two real fixes are spec changes, so I'm asking first:
  - a ~512 px WebP "card" image from the tile build (~25 KB, needs a new tile output in ARCHITECTURE / DEPLOYMENT);
  - or server-rendering the room list.

  **Resolved 2026-11-03:** both were built (see Added); the dashboard is now at 91.
- Server prefetch (2026-11-03): a failed prefetch renders without the data instead of redirecting to `/login`. The server can't refresh the session (the refresh cookie is scoped to `/api/v1/auth`), and the client's refresh-on-401 already handles it. `X-Forwarded-For` is forwarded because the API's global limit (300 / min) is keyed by `req.ip`; without it every dashboard load would count against the web container's IP.
- Local dev (2026-11-03): on Windows, `localhost` in `DATABASE_URL` / `REDIS_URL` makes every new connection wait ~2 s (Docker binds 127.0.0.1 only, `::1` is tried first). It made the first parallel prefetch time out. `.env.example` already uses `127.0.0.1`; keep it that way.
- Prefs: a `users.prefs` jsonb column (one row, merged with `||`) rather than a `user_prefs` table — one tiny object per user, read with `/me`, no join. Only `roomTourDone` today; unknown stored keys are ignored.
- The demo-boards response drops `roomId` and the author ids (`null`): the public endpoint shouldn't leak which room or which people made them. ≤ 3 ids enforced by the config.
- `/explore` with no demo boards shows the three bare maps instead of an empty page (so it is still useful in dev).
- `ENABLE_DEV_PAGES` and `SECURITY_CONTACT` are server-only web settings read per request (`src/lib/serverEnv.ts`), not `NEXT_PUBLIC_*`: they change without a rebuild and don't reach the browser. The dev map page is now dynamic (no `generateStaticParams`).
- Tablet keeps every tool of the role (the spec lists the ones that must work with touch; polygon and text work with taps too). Phone keeps undo / redo for editors.
- The phone's collapsed top-bar menu also carries Chat, Snapshots… and Export PNG (otherwise unreachable on a phone).
- Long-press only acts on elements the user may edit; viewers get nothing (they can't delete or relabel).
- Board actions: one "⋮" for the active board instead of one per tab — a `tablist` may only contain tabs (axe critical). Acting on another board means selecting it first.
- The tour is non-modal (the room stays usable) and stored as done on finish **or** skip / Esc. E2E users get it marked done at registration unless a test opts in (`registerViaUi(page, name, { tour: true })`).
- `Me.prefs` is `.default({ roomTourDone: false })` in the shared schema: a web build deployed before the API (or an old cached response) still parses.
- Landing / legal pages: the root layout no longer wraps `Providers` (React Query, sonner); route groups that need them add them. The nav's session check is a plain `fetch` (an expired access cookie reads as logged out; "Log in" then refreshes silently).
- Screenshots: WebP encoded in Chromium by the script rather than adding sharp to the web app (sharp is only a map-tiles dependency).
- New dev dependencies (named in the Phase 9 request, added to TECH_STACK): `@axe-core/playwright` 4.13.0 (4.14.0 was 11 days old), `lighthouse` 13.5.0.

### Decisions (Phase 8)
- E2E-11 requires the image to be exactly viewport × DPR, so the footer strip is drawn **over** the bottom 24 px of the map rather than appended below it.
- Clear layer of ≤ 50 elements still says "This can't be undone." (no snapshot is taken); above 50 it says "An automatic snapshot will be saved first."
- Snapshot list: hover prefetches the data and click opens the preview (a hover-opened modal would be hard to use).
- New endpoints:
  - `GET /api/v1/config { emailEnabled }`, so the UI can hide the email links before login;
  - `POST /auth/resend-verification` for the banner.

  `DELETE /me` gained `rooms: [{ roomId, action: 'transfer', toUserId } | { roomId, action: 'delete' }]`; a transfer target can be any member (viewers too), while the automatic fallback only picks editors.
- The email routes are always registered and return 404 while `EMAIL_ENABLED=false`, so the flag can change without a code change.
- `expireInvites` sets `revoked_at` on expired invites, so they leave the room's invite list.
- `audit_logs` has no foreign keys (it must outlive users, rooms and boards) and is pruned after 90 days.
- The snapshot being restored is never pruned by the restore's own auto snapshot, and it counts toward the 10 auto snapshots kept.
- Restore drops the board's `board_ops`: the op log can't describe the jump, so every client gets `board:reset` and resubscribes in full.
- Snapshots by a deleted account keep their row and show the anonymised author ("Deleted user").
- The measure line is local and is not part of the PNG export.
- The board-tab kebab is visible to viewers (it holds "Snapshots…"); rename / duplicate / delete inside it stay Editor+ / Owner.

### Decisions (Phase 7)
- `chat:send` dedupe is durable: a `client_id` column with UNIQUE `(author_id, client_id)` (DATABASE_SCHEMA §3.12 updated) instead of the 10-minute Redis set used for `opId`. A resend at any time returns the stored message and is not broadcast again. `ChatMessage` gained `clientId`, so the sender matches its optimistic copy even when the broadcast beats the ack.
- One broadcast path: the service raises a `chat:message` domain event and realtime emits it to the whole room, sender included. System messages use the same path.
- A ping to a board of another room (or a missing one) and a ping outside that board's map are both `VALIDATION_ERROR` — no hint whether the board exists (SECURITY Z2).
- Deleting a message overwrites its body with "message deleted" and clears the ping; the text is not kept. Deleting twice is a 204 no-op.
- The unread badge counts other people's **user** messages only; system messages don't. Shown on the Chat tab, or on the panel toggle when the panel is closed.
- The Chat tab is now the default panel tab (it is first in UI_UX_SPEC §3.5). The existing Phase 4/5 E2E tests open Members explicitly.
- Leaders need to know whether anyone follows them: a new server → client event `followers:update { count }` (API_SPEC §7.3) rather than sending view updates blindly.
- Summon starts following at once; "Don't follow" in the 5 s toast stops it silently. Opening a ping chip while following counts as a manual move.
- Under reduced motion a received ping shows a still ring for 3 s rather than nothing (it carries information); a chip's fly-to jumps with no ring.
- Follow mode can't rely on one volatile packet: while followed, the leader re-sends its view every 1.5 s (on top of ≤ 10 Hz on moves). A dropped `view:update` (e.g. right after a board switch, under load) then only delays the follower. Laser trails are pruned on a 300 ms timer as well as per frame, so they expire even when frames aren't drawn.
- Typing indicator (P2) is not built: `chat:typing` keeps its contract, with a `TODO(p2)`.
- System chat messages are fire-and-forget after the request, so `app.chatIdle()` drains them on shutdown. The integration harness also drains them before truncating tables, because an in-flight insert racing `TRUNCATE … CASCADE` deadlocked (1 s `deadlock_timeout`).

### Decisions (Phase 6)
- **Locked layers are locked for every role, the owner included.** FEATURES F5, API_SPEC §7.2 ("layer unlocked") and the server agree: element ops on a locked layer are refused for everyone. The 6A client let the owner draw on a locked layer, which the server would then roll back. That is fixed, and select / eraser ignore locked layers for every role. The owner unlocks first. (The Phase 6B brief said "non-owners can't select" — see the report.)
- The layers panel lists the top-most layer first, the usual layer-panel convention; rendering order is unchanged (higher `position` draws on top).
- The marquee is additive (it needs Shift, which already means "add" for clicks). Pressing an unselected element selects it, so a press-drag moves it straight away.
- Undo / redo stacks are kept per board; switching boards keeps them for the session. Layer ops are not undoable in v1. Only the part of a step that applied can be redone.
- The seq baseline (`mySeq`) is taken when an op is queued, not only when it is acknowledged, so undoing right after an edit works before the ack arrives.
- Online, bulk actions may push the pending count past 500 for a moment (they leave in ≤ 50-op batches at once); the 500 cap and the "refused whole" rule apply offline.
- Measure (Phase 8) and Laser (Phase 7) are in the toolbar but disabled, so viewers see exactly 3 tools (E2E-5).
- Selection corner handles are visual only (v1 has no scaling); the circle's radius handle is the one that works.
- Dependencies (TECH_STACK): simplify-js 1.2.4 (web).

### Decisions (Phase 5B)
- Dev/E2E sockets connect directly to the API (`NEXT_PUBLIC_SOCKET_URL`); the Next dev rewrite does not carry websocket upgrades. Production is unchanged (same origin via Caddy).
- `lastSeq` only advances contiguously; an out-of-order seq is held in `seenAbove`, and a gap that persists 2 s triggers a delta resubscribe.
- Resends are batched client-side and deduped per op server-side, so reconnecting with hundreds of pending ops stays under the rate limit and is safe to repeat.
- The proactive refresh reconnects silently; the server-side expiry disconnect is the fallback when it fails.
- The offline queue rejects new ops past 500 (`send()` returns false and the sync indicator shows the queue as full); the debug hook adds 1 000 elements as 2 × 500.
- Dependencies (TECH_STACK): zustand 5.0.16, immer 11.2.9, socket.io-client 4.8.4, uuid 14.0.3 (web).

### Decisions (Phase 5A)
- Durable ops and `board:subscribe` require `room:join` on the same socket first (`FORBIDDEN` otherwise). Ephemeral events only flow on the board the socket is subscribed to.
- `element:batch` broadcasts one `board:op` per op rather than a new batched event, so clients have a single apply path.
- Deleting an element that is already gone is a successful no-op *with a seq*, so concurrent deletes converge without a client-side rollback.
- Layers created via `layer:upsert` are appended at the end; ordering only changes through `layer:reorder`. `position` in `LayerInput` is accepted but ignored on create.
- Error codes on sockets reuse the REST set: locked layer and viewer writes → `FORBIDDEN`; an element whose `boardId` differs from the message → `BAD_REQUEST`.
- Session revocation fan-out uses the Socket.IO Redis adapter (`io.in('session:…').disconnectSockets()`), not a separate pub/sub channel. There is no periodic 5-minute token re-check: every revocation path disconnects immediately, and (since the 5A follow-ups) a socket is closed with `TOKEN_EXPIRED` 60 s after its access token expires.
- The volatile cap is a 40/s token bucket per socket. `socket.volatile` may additionally drop packets while a receiver is still flushing, which is intended for cursors.
- Chat events (`chat:send`, `chat:typing`) have their contracts in `packages/shared` but no handlers until Phase 7, so they are not in the socket authz matrix yet.
- Dependencies (TECH_STACK): socket.io 4.8.4, @socket.io/redis-adapter 8.3.0, node-cron 3.0.3, socket.io-client 4.8.4 (server tests + smoke script), @types/node-cron 3.0.11.

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
- 2026-11-03 — CI `security` job: dropped `cache: pnpm` from its `setup-node` step. The job never runs `pnpm install`, so on a cache miss setup-node's post step failed the job ("Path(s) specified in the action for caching do(es) not exist") although the audit and gitleaks had passed — seen on `main` before and after the Phase 11 merge.
- 2026-11-03 — Realtime shutdown: `broadcastPresence` could still publish through the Redis adapter while its clients were quitting (the adapter's rejected publish isn't returned to the caller), so `pnpm test:int` on a clean `main` passed 499 / 499 but exited 1 on 8 unhandled "Connection is closed" rejections in this VM. It now returns once `close()` has started, like `notifyFollowers`.
- 2026-10-26 — Accessibility issues found by the Phase 9 axe pass in earlier phases' UI:
  - White on `#EF4444` destructive buttons (3.8:1).
  - The presence stack's overlapping avatars (target size), with the focus outline suppressed.
  - `aria-label` on plain spans (member online dot, unread badge, board presence dots).
  - The board `tablist` owning menu buttons.
  - The room card's "Open room …" label hiding its visible text.
  - Auth-page links distinguishable by colour only.
- 2026-10-26 — AppShell rendered pages only after `/me` returned, so every page's own data (`/rooms`, the room) waited one extra round trip.
- 2026-10-26 — Toolbar showed undo / redo only when Pen was in the tool set (it is now based on `board.edit`), which would have hidden them on phones.
- 2026-10-26 — `cleanText(…, { keepNewlines: true })` kept tab (U+0009) as well as `\n`; SECURITY V3 allows only `\n` in chat. Now stripped (found by the new chat normalization test).
- 2026-10-26 — Realtime shutdown: follower-count notifications from sockets closing during `close()` published through the Redis adapter while its clients were quitting, which the adapter doesn't catch. Skipped once closing.
- 2026-10-26 — Realtime server: the fire-and-forget `presence.leave` on socket disconnect, `evict` after leave / kick and `broadcastPresence` had no rejection handler. With Redis unavailable they were unhandled rejections, which crash Node 22 by default (seen as 2 "Connection is closed" errors in `pnpm test:int` teardown). They now log a warning. `close()` uses `quit()` instead of `disconnect()` on the adapter clients, so pending publishes complete.
- 2026-10-26 — Dev env defaults (`apps/server/.env.example`, ENVIRONMENT.md): `DATABASE_URL` / `REDIS_URL` now use `127.0.0.1` instead of `localhost`. Compose binds IPv4 only, and on Windows the Prisma engine tries `::1` first, so every new pooled connection waited ≈ 2 050 ms (13 ms with `127.0.0.1`). Under concurrent load that surfaced as P2028 "Unable to start a transaction in the given time" (500 on `POST /rooms`) and > 1 s sync in the E2E latency tests.
- 2026-10-26 — Local Playwright runs are capped at 3 workers (CI unchanged). With 6 workers on a 12-thread machine, 12 browsers plus Next, the API and Postgres pushed op latency past the 1 s E2E-3 assertion.
- 2026-10-26 — `apps/server/package.json` and the lockfile had never declared the server's runtime deps `@fastify/cookie`, `@fastify/rate-limit`, `@node-rs/argon2`, `jose` and `uuid` (added in Phases 3 / 5A, versions recorded below). They only resolved from an existing local `node_modules`, so a fresh clone or CI install could not start the API. Now declared at the recorded versions (11.1.3, 11.2.1, 2.2.2, 6.2.13, 14.0.3).
- 2026-10-26 — 6A drawing gating let the owner draw on a locked layer, which the server refuses; fixed (see Decisions (Phase 6)). Web typecheck errors left by 6A in `roomSession.ts` (readonly `Pt[]` in `stroke:preview`, nullable `actorId`) fixed.
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
- Server: fastify 5.12.7, fastify-type-provider-zod 7.0.0, ioredis 5.11.1, prisma / @prisma/client 6.19.3, pino-pretty 13.2.0 (pino comes in through fastify), nodemailer 6.10.1, @types/nodemailer 6.4.24 (Phase 8); Phase 10: @fastify/helmet 13.2.0, @sentry/node 11.8.0, prom-client 15.1.3, nodemailer **10.1.7** (own types; @types/nodemailer removed)
- Web: next 16.4.3, react / react-dom 19.3.1, tailwindcss / @tailwindcss/postcss 4.3.3, lucide-react 1.61.0, clsx 2.1.1, tailwind-merge 3.7.0, class-variance-authority 0.7.1, @types/react / @types/react-dom 19.3.0, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, jsdom 30.1.3; dev (Phase 9): @axe-core/playwright 4.13.0, lighthouse 13.5.0
- Web, Phase 10: @sentry/nextjs 11.8.0
- Images: postgres:17-alpine, redis:7-alpine, axllent/mailpit; Phase 10: node:22-bookworm-slim (server), node:22-alpine (web), caddy:2.10-alpine; tools (not dependencies): grafana/k6:1.3.0, ghcr.io/zaproxy/zaproxy:stable, ghcr.io/gitleaks/gitleaks:v8.30.1

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
