# ARCHITECTURE — RotationLab

## 1. High-level view

```
                         ┌──────────────────────────────┐
                         │        Browser (client)       │
                         │  Next.js app (React)          │
                         │  ├─ Leaflet map + tile layer  │
                         │  ├─ Drawing engine (Zustand)  │
                         │  ├─ Socket.IO client          │
                         │  └─ TanStack Query (REST)     │
                         └──────┬───────────────┬────────┘
                    HTTPS (REST)│               │WSS (Socket.IO)
                                ▼               ▼
                      ┌────────────────────────────────┐
                      │   Reverse proxy (Caddy)         │  TLS, gzip/brotli,
                      │   app.example.com               │  security headers
                      │   /            → web:3000       │
                      │   /api/*       → server:4000    │
                      │   /realtime/*  → server:4000    │
                      │   /tiles/*     → CDN / R2       │
                      └───────┬───────────────┬────────┘
                              ▼               ▼
              ┌─────────────────────┐  ┌─────────────────────────┐
              │ web (Next.js SSR)   │  │ server (Fastify + S.IO) │
              │ pages, auth guard   │  │ REST /api/v1            │
              └─────────────────────┘  │ Realtime /realtime      │
                                       │ services / repositories │
                                       └────┬───────────┬────────┘
                                            ▼           ▼
                                   ┌──────────────┐ ┌──────────┐
                                   │ PostgreSQL   │ │ Redis    │
                                   │ (Prisma)     │ │ adapter, │
                                   │ durable data │ │ presence,│
                                   └──────────────┘ │ ratelimit│
                                                    └──────────┘
         Object storage (Cloudflare R2 / S3) + CDN ← tiles uploaded once by packages/map-tiles
```

**Key rule:** web and API are served from the **same origin** (`app.example.com`, API under `/api`) so auth cookies are first-party, `SameSite=Lax` works, and no CORS is needed in production.

## 2. Monorepo packages

| Package | Responsibility |
|---|---|
| `apps/web` | Next.js App Router UI. Server components for shell pages (landing, dashboard); client components for the room/map screen. Never talks to the DB. |
| `apps/server` | Fastify REST API + Socket.IO server in one Node process. Owns all business rules, auth and DB access. |
| `packages/shared` | Single source of truth: Zod schemas, inferred TS types, socket event contracts, map registry, constants (limits, roles). Imported by both apps. |
| `packages/map-tiles` | CLI scripts: `fetch` (download high-res art via Git LFS) and `build` (slice into tiles, write manifest). Not deployed. |

## 3. Backend structure (`apps/server/src`)

```
src/
├─ index.ts                 # boot: config → db → redis → fastify → socket.io
├─ config.ts                # env parsing with Zod (fail fast)
├─ plugins/                 # fastify plugins: cookies, helmet, rate-limit, auth, error handler
├─ modules/
│  ├─ auth/      routes.ts  service.ts  tokens.ts
│  ├─ users/     routes.ts  service.ts
│  ├─ rooms/     routes.ts  service.ts  policy.ts
│  ├─ invites/   routes.ts  service.ts
│  ├─ boards/    routes.ts  service.ts
│  ├─ layers/    service.ts
│  ├─ elements/  service.ts            # used by realtime handlers
│  ├─ snapshots/ routes.ts  service.ts
│  └─ chat/      routes.ts  service.ts
├─ realtime/
│  ├─ server.ts             # socket.io setup, redis adapter, auth middleware
│  ├─ handlers/room.ts      # room:join/leave, presence
│  ├─ handlers/board.ts     # board:subscribe, element ops, layer ops
│  ├─ handlers/chat.ts
│  ├─ handlers/ephemeral.ts # cursor, laser, view, stroke preview
│  └─ rateLimiter.ts        # per-socket token buckets
├─ db/prisma.ts
├─ lib/                     # logger (pino), errors, ids, time
└─ jobs/                    # cron: purge deleted rooms, prune op log, expire invites
```

Layering: **route/handler → service → Prisma**. Authorization lives in `policy.ts` functions (e.g. `canEditBoard(member, layer)`) called from services, so REST and socket paths share the same checks.

## 4. Frontend structure (`apps/web/src`)

```
app/
├─ (marketing)/page.tsx          # landing
├─ (auth)/login, register, forgot-password, reset-password
├─ (app)/dashboard/page.tsx      # my rooms
├─ (app)/rooms/[roomId]/page.tsx # room shell → <RoomWorkspace/>
├─ (app)/join/[code]/page.tsx    # invite landing
├─ (app)/settings/page.tsx
└─ layout.tsx
components/
├─ map/        MapCanvas.tsx  TileLayers.tsx  GridLayer.tsx  ElementLayer.tsx  CursorLayer.tsx  Minimap.tsx
├─ tools/      Toolbar.tsx  StylePanel.tsx  tools/*.ts (one file per tool: pointer handlers)
├─ room/       BoardTabs.tsx  LayersPanel.tsx  MembersPanel.tsx  ChatPanel.tsx  InviteDialog.tsx
└─ ui/         shadcn components
stores/
├─ boardStore.ts      # elements Map, layers, seq, pending ops, undo/redo stacks
├─ uiStore.ts         # active tool, style, panels open
└─ presenceStore.ts   # members online, cursors
lib/
├─ socket.ts          # singleton Socket.IO client, typed events from shared
├─ api.ts             # fetch wrapper (credentials: 'include', refresh-on-401)
├─ serverApi.ts       # server-side prefetch → HydrationBoundary (see below)
├─ coords.ts          # world ↔ Leaflet LatLng ↔ grid ref
└─ exportPng.ts
middleware.ts         # redirects unauthenticated users away from (app) routes
```

**Server prefetch (after Phase 9).** The `(app)` layout fetches `GET /me` and the dashboard page `GET /rooms` on the server (`INTERNAL_API_URL`) and seed the React Query cache through a `HydrationBoundary`, so the dashboard's first room card — its LCP element — is in the first HTML response. Rules:
- forward **only** the access cookie, plus the request's `X-Forwarded-For` so the API's per-IP limits see the user (Caddy sets it; the API trusts it with `TRUST_PROXY=true`);
- validate with the shared response schemas; on any non-200, timeout (1.5 s), network error or schema mismatch, render without the data and let the client fetch as before — the server never refreshes a session (the refresh cookie is scoped to `/api/v1/auth`);
- `/me` is seeded in the layout, above `AppShell`, so `AppShell`'s query starts with data; page-specific data is seeded in the page.

## 5. Map rendering & coordinate system ⭐

### 5.1 World units
All persisted geometry uses **PUBG world units = centimetres**, origin top-left, x → east, y → south, range `0 … mapSize` where `mapSize = 816000` for Erangel, Miramar and Rondo (nominally "8×8 km"; strictly 8.16 km per side). This matches PUBG telemetry, so future replay overlays need no conversion.

### 5.2 Map registry (`packages/shared/src/maps.ts`)
```ts
export const MAPS = {
  erangel: { id: 'erangel', name: 'Erangel', telemetryNames: ['Erangel_Main', 'Baltic_Main'],
             worldSize: 816000, gridCells: 8, tileSize: 256, maxNativeZoom: 5, // set from tiles manifest
             variants: { labels: '/tiles/erangel/labels', clean: '/tiles/erangel/clean' } },
  miramar: { id: 'miramar', name: 'Miramar', telemetryNames: ['Desert_Main'], worldSize: 816000, ... },
  rondo:   { id: 'rondo',   name: 'Rondo',   telemetryNames: ['Neon_Main'],   worldSize: 816000, ... },
} as const;
export type MapId = keyof typeof MAPS;
```
Adding a map later = run tile script + add one entry here + extend the `MapId` DB enum.

### 5.3 Leaflet CRS
Use a custom simple CRS so **Leaflet LatLng == world units** (lat = y, lng = x):
```ts
const W = map.worldSize;                       // 816000
const crs = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(256 / W, 0, 256 / W, 0), // y grows downward
});
// zoom 0 → whole map fits one 256px tile; zoom z → 256·2^z px
const bounds = L.latLngBounds([0, 0], [W, W]);
<MapContainer crs={crs} minZoom={-1} maxZoom={maxNativeZoom + 2} maxBounds={bounds.pad(0.1)} ... />
<TileLayer url={`${variant}/{z}/{y}/{x}.webp`} maxNativeZoom={maxNativeZoom} noWrap bounds={bounds} tileSize={256} />
```
Note the **`{z}/{y}/{x}`** order — this is what `sharp`'s `layout: 'google'` writes.

### 5.4 Grid reference
`gridRef(x, y)`: column = `'ABCDEFGH'[floor(x / (W/8))]`, row = `'IJKLMNOP'[floor(y / (W/8))]` → e.g. `"F-M"`. With W = 816 000 a square is 102 000 cm (1.02 km). Sub-square = 1/10 of a square (10 200 cm ≈ 102 m), shown as `F-M 4,7`; minor grid lines use the same W/80 spacing so they stay aligned with the major squares. Verify letter scheme in game before release; it is a constant in `maps.ts`.

### 5.5 Distance
`metres = hypot(dx, dy) × metresPerUnit` — `0.01` for PUBG maps, `widthM / 816000` for a custom map (`distanceMetres` / `measure` take it as an argument; the map view provides it through `BoardMapContext`). Travel-time estimates use `SPEEDS = { foot: 6, vehicle: 22 }` m/s (configurable estimates, labelled "approx." in UI).

### 5.6 Custom maps (F20)
A custom map uses the same `0 … 816000` square, so storage, validation, sync, the grid and the CRS are unchanged: the server fits the uploaded image into ≤ 4096 px, pads it to a centred square (dark fill) and the web draws it as one Leaflet `ImageOverlay` over `[[0,0],[816000,816000]]` instead of tiles (`customMapConfig`: `sourceSize = paddedSize = 4096`, `maxNativeZoom 4`). Only the scale differs: the uploader gives the real width of the image's longer side in metres, and every distance uses `metresPerUnit = widthM / 816000` — so changing the width later rescales all measurements without touching geometry. PUBG-only features are off on custom maps: the labels variant, vehicle spawns and zone presets. A board points at its map with `boards.custom_map_id`; the web resolves a board to a `BoardMapInfo` (`lib/boardMap.ts`, PUBG or custom) that carries the geometry, scale, images and backdrop.

Images are private to the room: keys `maps/<roomId>/<random>.webp` (+ `-512` preview), never public. Every response carries **signed URLs** — S3 SigV4 presigned GET on R2, or `GET /api/v1/assets/maps/…?exp=&sig=` (HMAC derived from `JWT_SECRET`) on the local disk backend. Signatures are issued per 6 h window and valid 12 h, so a URL stays the same for hours (browser cache) and the list is refetched every 30 min.

## 6. Tile pipeline (`packages/map-tiles`)

1. **fetch** — `git clone --depth 1 --filter=blob:none --sparse` the PUBG repo, `git lfs pull --include` the 6 files (`{Erangel,Miramar,Rondo}_Main[_No_Text]_High_Res.png`). Verify SHA-256 against LFS pointer `oid`.
2. **build** — for each image:
   - Detect format by magic bytes (Rondo low-res is a JPEG named `.png`).
   - Read size with `sharp(file, { limitInputPixels: false }).metadata()`; require square.
   - If side isn't a power-of-two multiple of 256, pad (transparent/sea color) to next power of two **and record the scale** so world→pixel mapping stays exact.
   - `sharp(...).webp({ quality: 82 }).tile({ size: 256, layout: 'google', overlap: 0 }).toFile(out/<map>/<variant>)`.
   - Generate 1024px preview JPEG (auth backdrop), 512px card WebP q72 (dashboard room cards, 34–59 KB vs 151–228 KB for the 1024 px JPEG — the dashboard's LCP image) + 256px thumbnail per map.
   - Write `out/manifest.json`: `{ map, variant, sourceSize, paddedSize, maxNativeZoom, sha256 }`.
   - Phase 12: the loot item icons listed in `packages/shared/src/loot.ts` (`Assets/Icons/Item/**`, `Assets/Icons/CarePackage/*` — plain git blobs, fetched in the same sparse checkout, PNG checked by magic bytes, SHA-256 recorded) → `out/icons/items/<id>.webp`, each fitted into a transparent 64 px square (2× the marker), ≈ 125 KB for all 80. Deployed with the tiles.
3. **upload** — `rclone sync out/ r2:rotationlab-tiles/` (or copy into `apps/web/public/tiles` for local dev).
   Tiles are immutable → `Cache-Control: public, max-age=31536000, immutable`; version path (`/tiles/v1/...`) when regenerating.

Measured output (Oct 2026, api-assets@32b13b5): all six source images are 8192×8192 px (no padding), so maxNativeZoom = 5 and each tile set is 1 365 tiles (z0–5). 6 sets = 8 190 tiles, ≈ 94 MB WebP q82 (≈ 113 MB with previews). `fetch` ≈ 2–3 min (≈ 650 MB LFS download); `build` ≈ 25 s on a desktop CPU, peak RAM well under 1 GB.

## 7. Realtime sync model ⭐

### 7.1 Channels
- Socket.IO path `/realtime`, one connection per tab.
- Socket rooms: `room:{roomId}` (chat, presence, room events) and `board:{boardId}` (element ops, cursors on that board).

### 7.2 Durable operations (persisted)
```
client                         server                                  other clients
  │ element:upsert {opId, boardId, element}                                 │
  │──────────────────────────────►│ 1. auth + role + layer-lock check       │
  │ (applied optimistically,      │ 2. Zod validate, size limits            │
  │  marked pending)              │ 3. txn: seq = boards.last_seq + 1       │
  │                               │    upsert element (seq), insert op log │
  │◄──────── ack {opId, seq} ─────│ 4. emit to board:{id} (except sender)  │
  │                               │────── board:op {seq, op, actorId} ────►│
```
- Op types: `element:upsert`, `element:delete`, `layer:upsert`, `layer:delete`, `layer:reorder`, `board:clearLayer`.
- **Conflict resolution:** last-writer-wins per element, ordered by server `seq`. Each element carries `seq` of its last write; clients ignore incoming ops whose `seq` ≤ element's current `seq`.
- **Element IDs** are UUIDv7 generated on the client (lets optimistic create work offline-ish).
- **Rejected op** → server sends `op:reject {opId, code}`; client rolls back that pending op.
- Ops are batched on the client: `element:batch {ops[]}` max 50 ops / 64 KB per message (used for multi-select move, paste, undo of a group).

### 7.3 Ephemeral events (never persisted, `socket.volatile`)
| Event | Rate | Purpose |
|---|---|---|
| `cursor:move` | ≤ 20 Hz in, `cursor:batch` out at 20 Hz | live cursors. Phase 10: the server keeps each board's latest position per user and flushes one `cursor:batch` per board every 50 ms — with N people moving, each recipient gets 20 messages/s instead of 20 × (N−1), and the Redis adapter publishes once per board per tick. A socket's membership check for its cursor stream is reused for 5 s (a kick disconnects at once, SECURITY Z5) |
| `stroke:preview` | ≤ 20 Hz | others see a pen stroke while it is being drawn; final stroke sent as `element:upsert` on pointer-up |
| `laser:point` | ≤ 30 Hz | laser trail |
| `chat:typing` | ≤ 1 / 2 s per socket | typing indicator (Phase 11): relayed to the room channel without the sender; receivers expire it after 4 s |
| `view:update` | ≤ 10 Hz | viewport broadcast, only while someone follows you — the server tells a leader its follower count with `followers:update { count }` (on follow start/stop, a follower disconnecting, and the leader's `room:join`); the leader also re-sends every 1.5 s while followed |

Summon (`summon`): receivers start following at once (opt-out toast). Chat unread counts ignore system messages. Chat pings are validated server-side: the board must be in the room and the point inside its map, else `VALIDATION_ERROR`.

All ephemeral events are **best-effort**: volatile emits may be dropped and are never replayed, so receivers expire stale state (ghost after 3 s, cursor fade after 5 s).

### 7.4 Join / resync
1. `room:join {roomId}` → server checks membership → returns `{ room, members, presence, boards[] }`.
2. `board:subscribe {boardId, sinceSeq?}`
   - if `sinceSeq` given and op log still holds `sinceSeq+1 … last` → server sends `board:ops {ops[]}` (delta).
   - else → `board:state {layers, elements, seq}` (full snapshot; elements of a board are ≤ 5 000 so a full load is acceptable, gzip via perMessageDeflate).
3. Pending local ops that were never acked are re-sent after resync (idempotent by `opId`: server keeps a 10-minute `opId` dedupe set in Redis).
4. **Offline queue and bulk ops:** the client queues at most **500 ops** while unacknowledged (the cap counts ops, not user actions). Online, bulk actions go out as `element:batch` chunks of ≤ 50 ops. Offline, a bulk action whose op count exceeds the remaining queue capacity is refused whole with a toast — never partially queued. `layer:clear` counts as one op.

### 7.5 Undo / redo
Client-side only. Each local action pushes an **inverse op** onto the user's undo stack. Undo = send the inverse as a normal op. If the element was since changed by someone else (`seq` moved), undo of that item is skipped with a toast "changed by X".

Implementation (Phase 6, `stores/boardModel.ts` + `lib/editing.ts`):
- A step stores, per element, its state **before and after** the action (`null` = absent). Undo writes `before`, redo writes `after`, each as a new op with a new opId; bulk steps go out as `element:batch` chunks of ≤ 50.
- The seq rule uses `mySeq[id]` = the newest seq this user acted on: the confirmed seq an edit was based on when it was queued, raised to the user's own op's seq on ack. An element is "changed by someone else" when its confirmed seq is above `mySeq[id]`, or when it exists / doesn't exist contrary to the step. The name comes from `updatedBy`, or from whoever deleted it.
- 100 steps per board, session-only; a rejected op removes its element from the step that holds it.

### 7.6 Presence
Redis hash `presence:{roomId}` → `userId → {socketCount, boardId, lastActive, color}` with 60 s TTL refreshed by heartbeat. Multiple tabs counted. Broadcast `presence:update` on change.

### 7.7 Scaling
- Socket.IO **Redis adapter** so multiple server instances share rooms.
- Prefer `transports: ['websocket']`; if polling fallback is enabled, use sticky sessions at the proxy.
- Seq allocation inside a Postgres transaction (`UPDATE boards SET last_seq = last_seq + 1 ... RETURNING last_seq`) is correct across instances. For hot boards it's ~1 row lock per op — fine at v1 scale; can move to Redis `INCR` + async write-behind later.

### 7.8 Voice chat (FEATURES F19)
- **Topology:** a WebRTC **mesh**, audio only — each participant holds one `RTCPeerConnection` per other participant, so a speaker uploads one Opus stream per listener. That is why the channel is capped at `VOICE_MAX_PEERS` = 8 (≈ 7 × 30–40 kbps up). No media touches our servers; only signalling does.
- **Signalling** rides the room socket: `voice:join` / `voice:leave` / `voice:mute` (acked) and `voice:signal` (offers, answers, trickle ICE; reliable, un-acked, relayed to one socket). The channel *is* the Socket.IO room `voice:{roomId}` — the Redis adapter keeps it right across instances and drops a socket the moment it disconnects, so there is no separate list to go stale; `socket.data.voice` only carries the mute flag. Joins take a 3 s Redis lock per room so the cap holds when people join at once.
- **Negotiation:** of each pair, the smaller peer id (socket id) offers — no glare — and restarts ICE when the link fails or stays disconnected for 5 s. A newcomer offers to the larger ids it gets in the join ack; existing peers with smaller ids offer when the `voice:peers` broadcast names the newcomer. Signals that beat the join ack are queued. A reconnect means a new socket and peer id: the client closes its links and joins again by itself.
- **NAT traversal:** STUN (`stun.cloudflare.com`) for direct routes; when `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` are set, each join also gets short-lived Cloudflare TURN credentials (6 h, minted server-side; port-53 URLs dropped) so peers on strict NATs (mobile data, campus Wi-Fi) relay through Cloudflare. Cloudflare failure → STUN only, never a failed join.
- **Client:** `lib/voice/voiceSession.ts` (connections, mic, mute / deafen / push-to-talk, speaking detection with an `AnalyserNode` per stream polled every 100 ms) writes `stores/voiceStore.ts`; `components/room/VoiceControls.tsx` renders it. Mute disables the mic track — no renegotiation. No usable mic → listen-only.

## 8. REST vs realtime split

| Via REST (`/api/v1`) | Via Socket.IO |
|---|---|
| auth, profile | element / layer ops |
| room CRUD, members, roles, invites | presence, cursors, laser, follow |
| board list/CRUD (metadata) | chat send / delete (persisted + broadcast) |
| snapshots CRUD / restore | board subscribe / resync |
| chat history pagination | room events (kicked, role changed, board created) |

REST mutations that affect live users (kick, role change, board create/delete, snapshot restore) also emit a socket event from the service layer.

## 9. Data flows

### 9.1 Draw a circle
pointer-down → tool creates draft element in `boardStore` (local only) → pointer-move updates radius (local + `stroke:preview`) → pointer-up → `element:upsert` → optimistic apply → ack → pending cleared.

### 9.2 Map ping in chat
User clicks chat "📍" (or `Alt+click` on map) → picks point → `chat:send {text, ping:{boardId, x, y}}` → server stores message with ping columns → broadcast `chat:message` → recipients render grid ref; click → `map.flyTo` (switches board if needed) + pulse animation.

### 9.3 Snapshot restore
REST `POST /boards/:id/snapshots/:sid/restore` → service creates auto-snapshot of current state → in one transaction replaces layers/elements → bumps `last_seq` → emits `board:reset {seq}` → clients re-subscribe and load full state.

## 10. Error handling & observability
- Uniform REST error shape (`API_SPEC.md §1.4`). Socket errors via ack callbacks `{ ok:false, code, message }`.
- Logging: pino JSON logs with `reqId`, `userId`, `roomId`; never log tokens, passwords, chat bodies.
- Metrics: `/metrics` (Prometheus, internal only): sockets connected, ops/sec, op latency histogram, rejected ops.
- Errors: Sentry (optional, env-gated) for web and server.

## 11. Background jobs (node-cron inside server, single leader via Redis lock)
| Job | Schedule | Action |
|---|---|---|
| purgeDeletedRooms | every 3 h (:07) | hard-delete rooms soft-deleted > 7 days |
| pruneOpLog | every 3 h (:07) | delete `board_ops` older than 24 h, keep last 1 000 per board |
| expireInvites | every 3 h (:07) | mark expired invites (an expired invite is refused on use regardless) |
| expireShareLinks | every 3 h (:07) | delete expired share links (refused on use regardless) |
| cleanupRefreshTokens | daily (03:08) | delete expired/revoked tokens > 30 days |

All jobs share slots on purpose (2026-11-28): the free Neon database counts compute only while awake and sleeps after 5 idle minutes, so one wake-up every 3 h beats a query every 15 min.
