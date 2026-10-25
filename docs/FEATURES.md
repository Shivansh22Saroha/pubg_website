# FEATURES — RotationLab

Feature-by-feature behavior. Each section: purpose · rules · edge cases · acceptance criteria (AC). PRD IDs in brackets.

---

## F1. Authentication [AUTH-1…8]
**Rules**
- Username stored lower-case; display name free text (1–32 chars, emoji allowed).
- Access token 15 min, refresh 30 days rolling. "Remember me" not offered — always 30 days; logout-all exists.
- Middleware on `(app)` routes calls `GET /me` server-side (forwarding cookie); unauthenticated → `/login?redirectTo=…`. `redirectTo` must be a relative path starting with `/` (open-redirect guard).

**AC**
- Registering then refreshing the page keeps the user logged in.
- After 15 min idle, the next API call transparently refreshes.
- Using an old refresh token twice logs out all sessions of that family.

---

## F2. Rooms & membership [ROOM-1…8]
**Rules**
- Room creation also creates the first board + 3 default layers (Plan `#F2A900`, Enemies `#EF4444`, Zones `#F8FAFC`).
- Exactly one Owner. Owner cannot leave without transferring ownership or deleting the room.
- Default role for new joiners is the room's `defaultRole` unless the invite specifies a role.
- Member limit counted at accept time inside a transaction.
- `lastActivityAt` updated on any durable op (debounced to once per minute per room).

**Edge cases**
- Owner's account deleted → ownership auto-transfers to the longest-standing Editor; if none, room soft-deleted.
- Invite created by an Editor who is later downgraded to Viewer remains valid but capped at Viewer role.

**AC**
- A kicked user's open tab loses access within 1 s and cannot rejoin via an old invite (kicked users must get a new invite; old invites still work → acceptable in v1, owner can revoke).

---

## F3. Map viewer [MAP-1…5]
**Rules**
- Base layers: `labels` (from `*_Main_High_Res`) and `clean` (from `*_Main_No_Text_High_Res`). Toggle `N`. Choice stored per user in `localStorage` (try/catch).
- Initial view: fit whole map. Max zoom = `maxNativeZoom + 2` (over-zoom with upscaled tiles for precise placement).
- Grid overlay: 8×8 major lines every 102 000 cm (1.02 km) labelled A–H (top) / I–P (left), drawn as a Leaflet canvas layer; at zoom ≥ `maxNativeZoom − 1`, minor lines every 10 200 cm (≈ 102 m, 1/10 of a square) appear at 30 % opacity.
- HUD shows cursor grid ref `F-M 4,7` + metres from top-left.
- Sea / out-of-bounds: `maxBounds` with 10 % padding, `maxBoundsViscosity: 0.8`.
- While tiles load, show the 819 px low-res image as an `ImageOverlay` under the tile layer.

**AC**
- Pan/zoom 60 fps on a 2020 mid-range laptop with 1 000 elements.
- Toggling labels causes no flash of empty map at the current zoom.

---

## F4. Boards [BOARD-1…3]
**Rules**
- Max 20 boards/room. Name 1–40 chars. Default name `"{Map} – Plan {n}"`.
- Duplicate copies layers + elements with new IDs (server-side), name `"{name} (copy)"`.
- Delete: Owner only, confirm dialog, cannot delete the last board. Users on a deleted board are moved to the first board with a toast.
- Tab order via drag & drop (Editor+), persisted in `position`.
- Each user's current board is local state; switching does `board:subscribe`. Last board per room remembered in `localStorage`.
- Thumbnail: generated client-side (256×256 JPEG of fit view) by the last editor 30 s after their last edit, uploaded via `PUT /boards/:id/thumbnail` (P1; until then show map thumbnail).

---

## F5. Layers [BOARD-4]
**Rules**
- 1–10 layers per board. New elements go to the **active layer** (per user, local).
- `visible` (board-wide) toggled by Editor+ affects everyone; each user can also locally "solo/hide" a layer (eye with slash in their own view only — shown as a different icon). v1: local hide only via Alt+click eye.
- `locked`: server rejects element ops on that layer; select tool ignores its elements.
- Deleting a layer deletes its elements (confirm shows count). Can't delete the last layer.
- Reorder changes rendering order (z of layer > z of element).

---

## F6. Drawing tools [DRAW-1…9]
Common behavior: tool creates a **draft** locally; others see a `stroke:preview` ghost (50 % opacity) for pen/line/arrow/circle/polygon while drawing; commit on finish → `element:upsert`. `Esc` cancels a draft.

| Tool | Interaction | Stored as | Notes |
|---|---|---|---|
| **Select (V)** | click to select, Shift+click multi, drag on empty map = pan, Shift+drag = marquee select; drag selected to move; circle shows radius handle; text double-click to edit | – | moving many elements → single `element:batch` on drop |
| **Pen (P)** | press-drag-release | STROKE | points sampled every ≥ 4 px screen distance, simplified (simplify-js, tolerance = 1.5 px in world units at current zoom), max 2 000 points (auto-commit and start a new stroke when exceeded) |
| **Line (L)** | press-drag-release | LINE | Shift snaps to 15° |
| **Arrow (A)** | click start, click bends, double-click / Enter to finish; or press-drag-release for a straight arrow | ARROW | max 50 points; head at last point; optional "double-headed" in style bar (P2) |
| **Circle (C)** | press at center, drag radius, release; radius label in m | CIRCLE | Zone preset dropdown places a circle of that radius on click; Shift = draw from edge |
| **Polygon (G)** | click vertices, click first point or Enter to close; Backspace removes last vertex | POLYGON | min 3, max 200 vertices |
| **Text (T)** | click → inline input → Enter commits, Esc cancels | TEXT | 1–120 chars, sizes sm/md/lg |
| **Marker (M)** | pick kind from flyout (remembered), click to place; for enemy squad, number auto-increments (next unused 1–25) | MARKER | label editable via select → double-click |
| **Eraser (E)** | click an element or drag across elements to delete those touched | – | respects locks/roles; batch delete |
| **Measure (R)** | click points, double-click to finish; shows segment + total metres + travel time; Esc clears | – (local only) | P2: "Save as line" button converts to LINE element |
| **Laser (K)** | hold mouse button/finger to show a fading trail to everyone | – (ephemeral) | trail lifetime 1.5 s |

**Styles**
- Color, width S/M/L (2/4/7 px screen), dashed, fill opacity (0–60 %, closed shapes).
- Last-used style remembered per tool.
- Stroke width is screen-constant (doesn't scale with zoom); markers screen-constant 28 px.

**Undo / redo**
- Per user, 100 steps, session-only (not persisted across reloads).
- Undo of create → delete; of delete → re-create with same id; of update → previous values.
- If target changed by someone else since (seq mismatch) → skip + toast.

**Limits** — 5 000 elements/board: at 4 500 show warning; at 5 000 tool commits fail with toast "Board is full — duplicate to a new board or clean up".

**Zone presets** [DRAW-8]
- `packages/shared/src/zones.ts` holds per-map arrays `{ label, radiusMetres }[]`.
- ⚠️ Ship with **placeholder values** and a TODO; fill with verified BGMI/PUBG phase radii before release. Presets are visual aids only.

---

## F7. Markers [DRAW-6]
| Kind | Default color | Number | Label |
|---|---|---|---|
| own_squad | `#38BDF8` | – | team tag (default room name initials) |
| own_player | `#38BDF8` | 1–4 | IGN |
| enemy_squad | `#EF4444` | 1–25 | team name / notes |
| vehicle | `#FACC15` | – | optional |
| drop | `#F2A900` | – | optional |
| danger | `#F97316` | – | optional |
| hold | `#22C55E` | – | optional |
| pin | layer color | – | optional |
- Hover tooltip: label + "placed by {user} · {time ago}".
- Own player markers can be linked to a member (dropdown) so the IGN label auto-updates (P2).

---

## F8. Realtime collaboration [RT-1…7]
- **Cursors**: shown only for users on the same board; name pill; hidden while user is idle > 5 s (fade) or follow mode active.
- **Presence**: online dot; idle (2 min no input) shows half-opacity avatar; board dots on tabs.
- **Follow**: follower's map mirrors leader's `center/zoom` with 200 ms smoothing; switching boards follows too. Any manual pan/zoom by follower exits follow mode (toast "Stopped following").
- **Summon**: leader triggers; each member gets non-blocking toast with "Don't follow" button (5 s).
- **Sync indicator** states defined in UI_UX_SPEC §3.5.
- **Reconnect**: exponential backoff 0.5 s → 10 s with jitter; on reconnect rejoin room + resubscribe board with `sinceSeq`.

**AC**
- Two browsers, same board: element created in A visible in B within 400 ms on localhost CI 100 % of 50 trials.
- Kill server for 5 s mid-session: both clients recover without reload and no element is lost or duplicated.

---

## F9. Chat & map pings [CHAT-1…6]
- Messages grouped by author when consecutive within 2 min.
- Ping creation: click 📍 in the chat input → cursor becomes crosshair → click map → chip attached to input; send. Shortcut: `Alt+click` anywhere on the map attaches a ping and focuses the chat input. (`P` is reserved for Pen.)
- Ping chip text: `📍 {gridRef} · {board name}`; click → switch board if needed, fly to, pulse.
- Pings also show a temporary pulse on the map for all users on that board when sent (3 s).
- Typing indicator "Rudra is typing…" (P2).
- System messages: join, leave, kick, role change, board created/deleted, snapshot saved/restored.
- History: 50 per page, infinite scroll up; "Jump to latest" button when scrolled up and new messages arrive.
- Unread badge on Chat tab / FAB when panel hidden.

---

## F10. Snapshots [BOARD-5]
- Manual: name required (1–60 chars). Max 50 manual per board; at limit, oldest must be deleted by user.
- Auto: before every restore and before `layer:clear` of > 50 elements; max 10, oldest pruned.
- Preview renders snapshot data read-only in a modal map (same renderer).
- Restore is atomic and broadcast as `board:reset`.

---

## F11. Measure & study [STUDY-1]
- Distance = sum of segment lengths in metres (`world / 100`), shown with thin space thousands separator: `3 420 m`.
- Travel time: `distance / speed` using `SPEEDS` config, formatted `~9 min`. Always labelled "approx.".
- Optional P2: elevation is **not** available (no height data) — don't fake it.

---

## F12. Export PNG [STUDY-2]
- Captures current viewport at device pixel ratio (max 2×): tiles + elements + optional grid; excludes cursors, selection, HUD.
- Adds a small footer strip: room · board · map · date · "PUBG map imagery © KRAFTON".
- Filename `{room-slug}_{board-slug}_{YYYY-MM-DD}.png`.
- Tiles must be served with `Access-Control-Allow-Origin` for the app origin so the canvas isn't tainted.

---

## F13. Demo / explore mode
- `/explore` loads the demo boards read-only without auth via `GET /api/v1/public/demo-boards` (rate-limited, cached 5 min). Board IDs come from env `DEMO_BOARD_IDS` (comma-separated, one per map).
- All tools except Measure disabled; map switcher swaps between three demo boards.

---

## F14. Notifications & toasts
- Toasts for: role changed, kicked, board deleted (you were on it), snapshot restored, op rejected (with reason), offline/online.
- No email/push notifications in v1.
