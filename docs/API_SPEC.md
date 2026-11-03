# API SPEC — RotationLab

- REST base: `/api/v1` (same origin as the web app)
- Realtime: Socket.IO, path `/realtime`
- Format: JSON, UTF-8. Timestamps ISO-8601 UTC. IDs UUID strings. Coordinates integer world units (cm).
- All schemas live in `packages/shared/src/schemas/*` (Zod). This document is the contract; the Zod files are the implementation.

## 1. Conventions

### 1.1 Authentication
- Cookies set by the server:
  - `rl_at` — access JWT, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`
  - `rl_rt` — opaque refresh token, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000`
- Clients send `credentials: 'include'`. No tokens in `localStorage`, headers or URLs.
- On `401 { code: "TOKEN_EXPIRED" }` the client calls `POST /auth/refresh` once, then retries the original request.

### 1.2 CSRF
All state-changing requests (`POST/PUT/PATCH/DELETE`) must send header `X-Requested-With: rotationlab` **and** the server verifies `Origin` equals `APP_ORIGIN`. Requests failing either → `403 CSRF_FAILED`.

### 1.3 Pagination
Cursor-based: `?limit=50&before=<id>` → response `{ items: [...], nextCursor: string | null }`. Max limit 100.

### 1.4 Error format
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable message", "details": [{ "path": "name", "issue": "too_short" }], "requestId": "01J…" } }
```
| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `ROOM_LOCKED`, `WRONG_ROOM_PASSWORD` |
| 404 | `NOT_FOUND` (also used instead of 403 when the caller is not a room member — avoid leaking existence) |
| 409 | `CONFLICT`, `USERNAME_TAKEN`, `EMAIL_TAKEN`, `ALREADY_MEMBER` |
| 410 | `INVITE_EXPIRED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `LIMIT_REACHED` (boards, layers, members, elements) |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` (+ `Retry-After` header) |
| 500 | `INTERNAL` |
| 503 | `MAINTENANCE` (+ `Retry-After: 300`) — every route but `/api/health` and `/metrics` while `MAINTENANCE=true`; socket handshakes fail with the same code (Phase 10, DEPLOYMENT §7) |

### 1.5 Common objects
```ts
PublicUser = { id, username, displayName, ign: string|null, avatarColor }
Me         = PublicUser & { email, emailVerified: boolean, createdAt }
RoomSummary= { id, name, description, role: 'OWNER'|'EDITOR'|'VIEWER', memberCount, onlineCount,
               boardCount, lastActivityAt, thumbnailUrl: string|null /* Phase 11: the primaryMapId board's thumbnail */, hasPassword: boolean,
               primaryMapId: 'erangel'|'miramar'|'rondo' /* map of the most recently updated board */ }
Member     = { user: PublicUser, role, joinedAt, online: boolean }
Board      = { id, roomId, name, mapId: 'erangel'|'miramar'|'rondo', position, elementCount, updatedAt }
Layer      = { id, boardId, name, color, position, visible, locked, seq }
Element    = { id, boardId, layerId, type, geometry, style, props, z, seq, createdBy, updatedBy, updatedAt }
ChatMessage= { id, roomId, author: PublicUser|null, kind: 'USER'|'SYSTEM', body,
               ping: { boardId: string|null /* null once that board is deleted */, x, y } | null,
               deleted: boolean, clientId: string|null /* the sender's idempotency key */, createdAt }
Invite     = { id, code, url, role, maxUses, useCount, expiresAt, createdAt }
Snapshot   = { id, boardId, name, isAuto, elementCount, createdBy: PublicUser|null, createdAt }
```

## 2. Auth

| Method & path | Auth | Body | Success |
|---|---|---|---|
| `POST /auth/register` | – | `{ email, username, password, displayName? }` | `201 { user: Me }` + cookies |
| `POST /auth/login` | – | `{ identifier, password }` (email or username) | `200 { user: Me }` + cookies |
| `POST /auth/refresh` | refresh cookie | – | `204` + new cookies (rotation) |
| `POST /auth/logout` | ✓ | – | `204`, clears cookies, revokes refresh token |
| `POST /auth/logout-all` | ✓ | – | `204`, revokes all user's refresh tokens |
| `GET  /auth/username-available?u=` | – | – | `200 { available: boolean }` (rate-limited) |
| `POST /auth/verify-email` | – | `{ token }` | `204` (P1) |
| `POST /auth/forgot-password` | – | `{ email }` | `202` always (no enumeration) (P1) |
| `POST /auth/reset-password` | – | `{ token, password }` | `204`, revokes all sessions (P1) |
| `POST /auth/resend-verification` | ✓ | – | `202` (3 / hour / user) (P1) |

Email routes (Phase 8): always registered, `404` while `EMAIL_ENABLED=false`. Tokens are 32 random bytes, base64url (43 chars); unknown, used, expired and wrong-purpose tokens all answer `400 BAD_REQUEST` "This link is invalid or has expired". `forgot-password`: 3 / hour / email + 10 / hour / IP, and the lookup + mail happen after the `202`. `reset-password` also clears the login lockout and marks the email verified; it clears the caller's cookies. `GET /api/v1/config` (public) → `{ emailEnabled }` so the UI can hide the links.

Validation: email RFC-ish ≤ 254; username `^[a-z0-9_]{3,20}$` (lower-cased); password 10–128 chars, not in breached list.

## 3. Users

| Method & path | Body | Success |
|---|---|---|
| `GET /me` | – | `{ user: Me }` — `Me.prefs = { roomTourDone }` (Phase 9) |
| `PATCH /me` | `{ displayName?, ign?, avatarColor? }` | `{ user: Me }` |
| `PATCH /me/prefs` | `{ roomTourDone?: boolean }` (strict, ≥ 1 key) | `{ prefs }` — merged into `users.prefs` key by key (`prefs \|\| patch` in one statement), so two devices never overwrite each other. UI preferences that must follow the user across devices (the room coach-mark tour); per-device conveniences stay in localStorage |
| `POST /me/password` | `{ currentPassword, newPassword }` | `204`, other sessions revoked |
| `GET /me/sessions` | – | `{ items: [{ id, userAgent, createdAt, current }] }` |
| `DELETE /me/sessions/:id` | – | `204` |
| `DELETE /me` | `{ password, confirm: "DELETE", rooms?: ({ roomId, action: 'transfer', toUserId } \| { roomId, action: 'delete' })[] }` | `204`, cookies cleared. Rooms you own without a choice go to the longest-standing editor, else are soft-deleted. Wrong password → 401; a choice for a room you don't own, or a transfer to a non-member → 400 and nothing changes |

## 4. Rooms

| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /rooms` | user | – | `{ items: RoomSummary[] }` |
| `POST /rooms` | user | `{ name, description?, password?, defaultRole?, firstBoard: { name, mapId } }` | `201 { room: RoomSummary, board: Board }` |
| `GET /rooms/:roomId` | member | – | `{ room: RoomSummary & { ownerId, isLocked, defaultRole, maxMembers }, members: Member[], boards: Board[] }` |
| `PATCH /rooms/:roomId` | OWNER | `{ name?, description?, defaultRole?, isLocked? }` | `{ room }` |
| `PUT /rooms/:roomId/password` | OWNER | `{ password: string \| null }` | `204` |
| `DELETE /rooms/:roomId` | OWNER | `{ confirmName }` | `204` (soft delete) |
| `POST /rooms/:roomId/leave` | member (not OWNER) | – | `204` |
| `POST /rooms/:roomId/transfer` | OWNER | `{ userId, password }` | `204` |

### Members
| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /rooms/:roomId/members` | member | – | `{ items: Member[] }` |
| `PATCH /rooms/:roomId/members/:userId` | OWNER | `{ role: 'EDITOR'\|'VIEWER' }` | `{ member }` + socket `member:roleChanged` |
| `DELETE /rooms/:roomId/members/:userId` | OWNER | `{ ban?: boolean }` (optional body) | `204` + socket `member:kicked` (target disconnected); `ban: true` also blocks rejoining |
| `GET /rooms/:roomId/bans` | OWNER | – | `{ items: [{ user: PublicUser, bannedBy: PublicUser\|null, createdAt }] }` |
| `DELETE /rooms/:roomId/bans/:userId` | OWNER | – | `204` (unban); `404` if not banned |

### Invites & joining
| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /rooms/:roomId/invites` | OWNER, EDITOR | – | `{ items: Invite[] }` |
| `POST /rooms/:roomId/invites` | OWNER, EDITOR | `{ expiresIn: '1h'\|'24h'\|'7d'\|'never', maxUses?: 1..100, role?: 'EDITOR'\|'VIEWER' }` (editors can only create ≤ their own role). Without `role`, the room's `defaultRole` **at creation time** is stored on the invite. | `201 { invite }` |
| `DELETE /rooms/:roomId/invites/:inviteId` | OWNER, creator | – | `204` |
| `GET /invites/:code` | – (public, rate-limited) | – | `{ room: { name, memberCount, ownerName, hasPassword, maps: string[] }, valid: boolean }` |
| `POST /invites/:code/accept` | user | `{ password? }` | `200 { roomId }`; errors `INVITE_EXPIRED`, `WRONG_ROOM_PASSWORD`, `ROOM_LOCKED`, `LIMIT_REACHED`, `ALREADY_MEMBER` (`409`, `details: [{ path: 'roomId', issue: <roomId> }]`); a banned user gets `403 FORBIDDEN` (generic message). The joining role is the lower of the invite's role and its creator's current role. |

## 5. Boards, layers, snapshots

| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /rooms/:roomId/boards` | member | – | `{ items: Board[] }` |
| `POST /rooms/:roomId/boards` | EDITOR+ | `{ name, mapId, duplicateFrom?: boardId }` | `201 { board }` + socket `board:created` |
| `PATCH /boards/:boardId` | EDITOR+ | `{ name?, position? }` | `{ board }` + socket `board:updated` |
| `DELETE /boards/:boardId` | OWNER | – | `204` + socket `board:deleted` (can't delete last board) |
| `GET /boards/:boardId/state` | member | – | `{ board, layers: Layer[], elements: Element[], seq }` (fallback for socket; used by PNG export/SSR thumbnail) |
| `GET /boards/:boardId/snapshots` | member | – | `{ items: Snapshot[] }` |
| `POST /boards/:boardId/snapshots` | EDITOR+ | `{ name }` | `201 { snapshot }` |
| `GET /snapshots/:snapshotId` | member | – | `{ snapshot, data: { layers, elements } }` |
| `POST /snapshots/:snapshotId/restore` | EDITOR+ | – | `200 { seq }` + socket `board:reset` |
| `DELETE /snapshots/:snapshotId` | OWNER, author | – | `204` |

Snapshot notes (Phase 8): saving / restoring needs `board.manage` (OWNER / EDITOR); listing and reading any member; snapshots of boards you can't see are `404`. The 51st manual snapshot → `422 LIMIT_REACHED`. Restore runs in one transaction (auto snapshot "Before restore of '{name}'" → layers + elements replaced with the snapshot's ids at a new seq → op log dropped so a `sinceSeq` resync becomes a full load → audit row) and only then emits `board:reset` and a system chat message. A `layer:clear` of a non-empty layer first saves an auto snapshot "Before clearing '{layer}'". Auto snapshots: at most 10 per board (the one being restored is never pruned).

Layer and element mutations go through **Socket.IO only** (§7).

### 5b. Share links (Phase 11)
| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /boards/:boardId/share` | OWNER, EDITOR | – | `{ share: { createdAt, expiresAt: string\|null } \| null }` — never the token |
| `POST /boards/:boardId/share` | OWNER, EDITOR | `{ expiresIn: '24h'\|'7d'\|'30d'\|'never' }` (strict) | `201 { share, url }`, `Cache-Control: no-store`. Creates the board's link, or **regenerates** it: a new token replaces the old one, which stops working at once. The only response that carries the URL |
| `DELETE /boards/:boardId/share` | OWNER, EDITOR | – | `204` (revoke; a board without a link is a no-op) |
| `GET /public/share/:token` | – (public) | – | `{ board, layers, elements, expiresAt }` — the board **as it is now**, same shape as a demo board (§8): no `roomId`, `createdBy` / `updatedBy: null`, no member names. 30 / min / IP, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` |

Notes: permission `board.share` (OWNER / EDITOR); non-members `404`, viewers `403`. One link per board. The token is 16 random bytes, base64url (22 chars, `ShareTokenSchema`); only its SHA-256 is stored, so the URL `{APP_ORIGIN}/s/{token}` can't be shown again — the dialog offers Regenerate. A malformed token → `400`; unknown, revoked, regenerated-away, expired, or a deleted room → the same `404 NOT_FOUND` "This link is invalid or has expired". Create / regenerate / revoke write audit rows (`share.create`, `share.regenerate`, `share.revoke`). The API's request log masks the token (`/public/share/[redacted]`). An hourly job deletes expired links.

## 6. Chat (REST part)
| Method & path | Role | Query | Success |
|---|---|---|---|
| `GET /rooms/:roomId/messages` | member | `limit, before` | `{ items: ChatMessage[], nextCursor }` (newest first) |
| `DELETE /messages/:messageId` | author or OWNER | – | `204` + socket `chat:deleted` |

Implementation notes (Phase 7):
- History: `limit` 1–100 (default 50), `before` = an id from the previous page; ids are UUIDv7 so id order = time order. `nextCursor` is null on the last page.
- Delete overwrites the body with `"message deleted"` (the original text is not kept), drops the ping and sets `deleted: true`; deleting again is a 204 no-op. Others → 403, non-members / unknown ids → 404.
- System messages (`kind: 'SYSTEM'`, no author) are created from the domain events: join, leave, kick, role change, board created / deleted (snapshot events: Phase 8). They arrive like any message (`chat:message`).

## 7. Realtime (Socket.IO)

### 7.1 Connection
```ts
io(APP_ORIGIN, { path: '/realtime', withCredentials: true, transports: ['websocket'] })
```
Handshake middleware reads `rl_at` cookie, verifies JWT and `Origin`. Failure → `connect_error` with `data.code` = `UNAUTHENTICATED` | `TOKEN_EXPIRED`. On `TOKEN_EXPIRED` the client calls `/auth/refresh` and reconnects. Server disconnects sockets when the access token's session is revoked (checked every 5 min and on logout events via Redis pub/sub).

All client→server events use **acks**: `socket.emit(event, payload, (res) => …)` where `res = { ok: true, data? } | { ok: false, code, message }`.

Implementation notes (Phase 5A/5B):
- **Join before subscribe:** `board:subscribe` and every durable op need a prior `room:join` on the same socket (`FORBIDDEN` otherwise).
- **Batch broadcasts:** `element:batch` emits one `board:op` per op (consecutive seqs) — clients have a single apply path.
- **Idempotent delete:** deleting an element that no longer exists succeeds as a no-op *with its own seq*, so concurrent deletes converge without rollbacks.
- **`summon`** uses the `board.edit` permission (OWNER/EDITOR).
- **Session expiry:** on connect the server emits `session { expiresAt }` (epoch ms of the access token's `exp`); clients refresh ~60 s before it and reconnect. A socket still open 60 s after `exp` gets `error { code: 'TOKEN_EXPIRED' }` and is disconnected (`io server disconnect`); the client refreshes and reconnects with a delta resync.
- `connect_error` codes: `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN` (Origin ≠ `APP_ORIGIN`), `LIMIT_REACHED` (> 5 sockets per user). In production the cookie is `__Host-rl_at`.
- Logout, logout-all, password change, session revoke and refresh-token theft disconnect the affected sessions' sockets on every instance (Redis adapter). Kick sends `member:kicked` to the target, then disconnects their sockets for that room.
- `board:subscribe` / durable ops require a prior `room:join` on that socket (`FORBIDDEN` otherwise); boards of rooms you aren't a member of are `NOT_FOUND`.
- `element:batch` broadcasts one `board:op` per op (consecutive seqs). Deleting an element that is already gone still gets a seq (no-op) so every client converges.
- Locked layer → `FORBIDDEN`; element outside the map → `VALIDATION_ERROR`; > 5 000 elements or > 10 layers → `LIMIT_REACHED`; last layer → `CONFLICT`.
- A resent `opId` (same user, within 10 min) returns the original seq(s) and is not re-applied or re-broadcast.
- **Batch semantics:** each *attempt* of `element:batch` is all-or-nothing (one transaction — any invalid op rejects the whole attempt). Resends are deduped **per op** (`opId`), so a retry of a batch whose ops were partly applied by an earlier attempt replays the known seqs and applies only the rest. Partial application across retries is therefore safe and converges.
- **Ephemeral events are best-effort:** `cursor:move` (delivered as `cursor:batch`), `laser:point`, `stroke:preview` and `view:update` are volatile — they can be dropped (rate cap, invalid payload, a receiver still flushing, reconnects) and are never replayed. Clients must not depend on receiving every one (ghosts expire after 3 s without updates, cursors fade after 5 s).
- Volatile events are dropped silently when invalid, over the cap, or not on the board the socket subscribed to; `stroke:preview` only flows from roles that can draw; `view:update` goes only to sockets that sent `follow:start` for that user.

### 7.2 Client → server
| Event | Payload | Ack data | Notes |
|---|---|---|---|
| `room:join` | `{ roomId }` | `{ members: Member[], presence: Presence[], boards: Board[] }` | joins `room:{id}` |
| `room:leave` | `{ roomId }` | – | |
| `board:subscribe` | `{ boardId, sinceSeq?: number }` | `{ mode: 'delta', ops: Op[], seq } \| { mode: 'full', layers, elements, seq }` | leaves previous board channel |
| `element:upsert` | `{ opId, boardId, element: ElementInput }` | `{ seq }` | EDITOR+, layer unlocked |
| `element:delete` | `{ opId, boardId, elementId }` | `{ seq }` | |
| `element:batch` | `{ boardId, ops: ({ opId, kind: 'upsert', element: ElementInput } \| { opId, kind: 'delete', elementId })[] }` (1–50 ops, ≤ 64 KB) | `{ seqs: number[] }` (one per op, consecutive) | all-or-nothing; broadcast as **one `board:op` per op** |
| `layer:upsert` | `{ opId, boardId, layer: LayerInput }` | `{ seq }` | EDITOR+ for unlocked layers; **lock/unlock, and any edit or delete of a locked layer, is OWNER-only** (`FORBIDDEN`) |
| `layer:delete` | `{ opId, boardId, layerId }` | `{ seq }` | deletes its elements |
| `layer:reorder` | `{ opId, boardId, order: layerId[] }` | `{ seq }` | |
| `layer:clear` | `{ opId, boardId, layerId }` | `{ seq }` | |
| `chat:send` | `{ clientId, roomId, body, ping?: { boardId, x, y } }` | `{ message: ChatMessage }` | a ping to another room's (or a missing) board, or outside that board's map → `VALIDATION_ERROR` (never revealing whether the board exists); body: NFC, control chars stripped except `\n`, trimmed, 1–500 code points; `room.interact` (viewers too) after `room:join`; ping board must be in this room and the point inside its map (`VALIDATION_ERROR`); 5 / 10 s per socket (`RATE_LIMITED`); a resent `clientId` returns the stored message and is not broadcast again |
| `chat:typing` | `{ roomId }` | – (no ack, volatile) | Phase 11: relayed as `chat:typing { userId }` to the rest of the room (not the sender), at most once per 2 s per socket (extras dropped). Only after `room:join` of that room and while a member (`room.interact`, viewers too); invalid / over-cap / foreign-room packets are dropped silently. Receivers show "X is typing…" for 4 s after the last event, or until X's message arrives |
| `cursor:move` | `{ boardId, x, y }` | – (no ack, volatile) | ≤ 20 Hz |
| `stroke:preview` | `{ boardId, tempId, points: Pt[], style }` | – volatile, best-effort | only new points since last; ≤ 20 Hz |
| `laser:point` | `{ boardId, x, y }` | – volatile | |
| `view:update` | `{ boardId, center: Pt, zoom }` | – volatile | only sent while ≥ 1 follower (`followers:update` count > 0): ≤ 10 Hz on moves, at once when a follower joins or the leader's new board is subscribed, and re-sent every 1.5 s so a dropped packet only delays followers |
| `follow:start` / `follow:stop` | `{ targetUserId }` | – | |
| `summon` | `{ boardId }` | – | asks all to follow you; permission `board.edit` (OWNER/EDITOR). Receivers start following **immediately** and may opt out ("Don't follow", 5 s) |
| `presence:heartbeat` | `{ roomId, boardId, idle: boolean }` | – | every 20 s |

`ElementInput` = `Element` without `seq, createdBy, updatedBy, updatedAt` (server sets them). `LayerInput` similarly.

### 7.3 Server → client
| Event | Payload |
|---|---|
| `board:op` | `{ boardId, seq, actorId, opId, op: { kind, ... } }` |
| `board:reset` | `{ boardId, seq, reason: 'snapshot_restore' \| 'clear', actorId }` → client resubscribes with full load and clears its undo / redo stacks for that board |
| `op:reject` | `{ opId, code, message }` (only if ack lost; normally via ack) |
| `board:created` / `board:updated` / `board:deleted` | `{ board }` / `{ board }` / `{ boardId }` |
| `chat:message` | `{ message: ChatMessage }` (to the whole room, sender included — the client matches its optimistic copy by `clientId`) |
| `chat:deleted` | `{ messageId }` |
| `chat:typing` | `{ userId }` |
| `presence:update` | `{ roomId, users: Presence[] }` where `Presence = { userId, boardId, idle, color }` |
| `cursor:batch` | `{ boardId, cursors: [{ userId, x, y }] }` — every 50 ms (`CURSOR_FLUSH_MS`), the latest position of each cursor on that board that moved since the last flush; one message per recipient per tick (Phase 10, replaces a per-move `cursor:move` broadcast). Includes the recipient's own cursor: ignore it. Volatile |
| `stroke:preview` | `{ userId, boardId, tempId, points, style }` |
| `laser:point` | `{ userId, boardId, x, y }` |
| `view:update` | `{ userId, boardId, center, zoom }` (only to followers) |
| `summon` | `{ userId, boardId }` |
| `followers:update` | `{ count }` → to the leader's sockets whenever their follower count changes (and on `room:join`); the leader sends `view:update` only while `count > 0` |
| `member:joined` / `member:left` | `{ member }` / `{ userId }` |
| `member:roleChanged` | `{ userId, role }` |
| `member:kicked` | `{ userId }` (target socket then force-disconnected) |
| `room:updated` / `room:deleted` | `{ room }` / `{ roomId }` |
| `error` | `{ code, message }` |

### 7.4 Socket limits (per socket, token buckets in memory + Redis for per-user)
| Event group | Limit |
|---|---|
| durable ops (`element:*`, `layer:*`) | 30 / s burst 60 |
| `chat:send` | 5 / 10 s burst 5 |
| volatile (`cursor`, `laser`, `stroke:preview`, `view`) | 40 / s combined; excess dropped silently |
| max message size | 64 KB (`maxHttpBufferSize`) |
| sockets per user | 5 |
Exceeding durable/chat limits → ack `RATE_LIMITED`; repeated abuse (10 violations / min) → disconnect.

## 8. Health & meta
| Path | Purpose |
|---|---|
| `GET /api/health` | `{ status: 'ok', db: 'ok', redis: 'ok', version }` |
| `GET /api/v1/maps` | static map registry `{ items: [{ id, name, worldSize, tileBaseUrl: { labels, clean }, maxNativeZoom, thumbnailUrl }] }` |
| `GET /api/v1/public/demo-boards` | read-only demo boards for `/explore`: `{ items: [{ board, layers, elements }] }`, no auth, rate-limited 30 / min / IP, `Cache-Control: public, max-age=300`. Only boards whose id is in `DEMO_BOARD_IDS` (≤ 3, env order; ids that don't exist or whose room is deleted are skipped; unset → `{ items: [] }`). The id list never comes from the request. Nothing points back at a room or a person: `board` has no `roomId`, elements have `createdBy` / `updatedBy: null` |
| `PUT /api/v1/boards/:boardId/thumbnail` | EDITOR+ (`board.edit`), raw `image/jpeg` body ≤ 100 KB, exactly 256×256 → `200 { thumbnailUrl }`. The server checks the JPEG magic bytes, decodes with sharp (pixel cap), re-encodes (q80, metadata stripped) and stores it under a fresh random key `thumbnails/<boardId>/<128-bit>.jpg`, then deletes the previous one; `boards.updated_at` is not touched. Other content types → `415 BAD_REQUEST`; > 100 KB → `413 PAYLOAD_TOO_LARGE`; not a 256×256 JPEG → `400 VALIDATION_ERROR`; viewers `403`, non-members `404` (Phase 11) |
| `GET /api/v1/assets/thumbnails/:boardId/:file` | public; the **local** storage backend only (dev / tests): serves a stored thumbnail (`image/jpeg`, immutable cache). Keys are unguessable like the R2 URLs; anything not shaped like a key we write → `400` / `404` (Phase 11) |
| `GET /metrics` | Prometheus, **internal network only** (Caddy never routes it). Process defaults, `http_request_duration_seconds{method,route,status}`, `socketio_connected_clients`. With `METRICS_TOKEN` set it also needs `Authorization: Bearer <token>`; a missing or wrong token gets `404` (Phase 10) |

## 9. Example: create a room
```http
POST /api/v1/rooms
Content-Type: application/json
X-Requested-With: rotationlab
Cookie: rl_at=…

{ "name": "Team Soul Scrims", "password": null, "defaultRole": "EDITOR",
  "firstBoard": { "name": "Erangel – Drop A", "mapId": "erangel" } }
```
```json
201
{ "room": { "id": "0192f7…", "name": "Team Soul Scrims", "role": "OWNER", "memberCount": 1, "onlineCount": 0,
            "boardCount": 1, "lastActivityAt": "2026-10-25T07:10:00Z", "thumbnailUrl": null, "hasPassword": false },
  "board": { "id": "0192f8…", "roomId": "0192f7…", "name": "Erangel – Drop A", "mapId": "erangel",
             "position": 0, "elementCount": 0, "updatedAt": "2026-10-25T07:10:00Z" } }
```

## 10. Example: draw an enemy marker
```ts
socket.emit('element:upsert', {
  opId: '0192f9a1-…',
  boardId: '0192f8…',
  element: { id: '0192f9a2-…', boardId: '0192f8…', layerId: '0192f8c0-…', type: 'MARKER',
             geometry: { at: [512300, 401800] }, style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
             props: { kind: 'enemy_squad', number: 7, label: 'Bridge team' }, z: 10 }
}, (res) => { /* { ok: true, data: { seq: 1042 } } */ });
```
