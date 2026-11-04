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
- An invite's role is fixed when the invite is **created**: the role given in the request, or else the room's `defaultRole` at that moment. Changing the room default later does not change existing invites.
- Member limit counted at accept time inside a transaction.
- `lastActivityAt` updated on any durable op (debounced to once per minute per room).

**Edge cases**
- Owner's account deleted → ownership auto-transfers to the longest-standing Editor; if none, room soft-deleted.
- Invite created by an Editor who is later downgraded to Viewer remains valid but capped at Viewer role.

**AC**
- A kicked user's open tab loses access within 1 s (sockets get `member:kicked` and are disconnected). A plain kick lets them rejoin with any still-valid invite. **Kick + block** (`ban: true`) adds a `room_bans` row: invite accept then refuses them with a generic `403 FORBIDDEN` until the owner unbans them (Room settings → Security → Blocked users).

---

## F3. Map viewer [MAP-1…5]
**Rules**
- Base layers: `labels` (from `*_Main_High_Res`) and `clean` (from `*_Main_No_Text_High_Res`). Toggle `N`. Choice stored per user in `localStorage` (try/catch).
- Initial view: fit whole map. Max zoom = `maxNativeZoom + 2` (over-zoom with upscaled tiles for precise placement).
- Grid overlay: 8×8 major lines every 102 000 cm (1.02 km) labelled A–H (top) / I–P (left), drawn as a Leaflet canvas layer; at zoom ≥ `maxNativeZoom − 1`, minor lines every 10 200 cm (≈ 102 m, 1/10 of a square) appear at 30 % opacity.
- HUD shows cursor grid ref `F-M 4,7` + metres from top-left.
- Sea / out-of-bounds: `maxBounds` with 10 % padding, `maxBoundsViscosity: 0.8`.
- While tiles load, show the 819 px low-res image as an `ImageOverlay` under the tile layer.
- Minimap [MAP-5] (Phase 11): bottom-right, 160×160, collapsible; the low-res image plus the current view's rectangle (clamped to the map). Click / drag on it re-centres the map; arrow keys pan while focused. Using it is a manual move (ends follow mode, F8). Hidden on phones.

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
- Thumbnail (Phase 11): generated client-side (256×256 JPEG of the fit view) by an editor 30 s after **their** last edit of the board (each local op restarts the clock; remote ops don't), uploaded via `PUT /boards/:id/thumbnail`. Drawn from the board model, not the live map: the map's low-res image, then visible layers bottom → top (markers as dots, no text labels). Leaving the board before the 30 s cancels it; failures are silent. The dashboard card shows the thumbnail of the room's most recently updated board, else the map's card image (also when the thumbnail fails to load).

### F4b. Public read-only share link (Phase 11, v1.1)
- Board kebab → **Share link…** (owner / editor). The dialog creates the link with an expiry (24 h, **7 days** default, 30 days, never), shows the URL once with Copy ("Copy it now — for safety the link is only shown once"), and afterwards shows "A link is active · Expires … · created …" with **Regenerate link** (new URL; the old one stops working at once) and **Revoke** (two clicks). One link per board.
- `/s/{token}` opens without an account: the board as it is at load time (reload for the latest; no socket, no live updates), tiles + grid + labels (HUD, N / Shift+G) and Measure (R). No tools, chat, presence, room name, member names or ids. CTA "Create account".
- Invalid, revoked, regenerated-away, expired links and deleted rooms all show "This link is invalid or has expired."
- AC: a viewer sees no "Share link…"; after revoke the visitor's reload shows the error; the page raises no CSP violation and opens no socket.

---

## F5. Layers [BOARD-4]
**Rules**
- 1–10 layers per board. New elements go to the **active layer** (per user, local).
- `visible` (board-wide) toggled by Editor+ affects everyone; each user can also locally "solo/hide" a layer (eye with slash in their own view only — shown as a different icon). v1: local hide only via Alt+click eye.
- `locked`: server rejects element ops on that layer **for every role, the owner included** (the owner unlocks first); select and eraser ignore its elements for everyone, and drawing on it is blocked with a toast. Only the owner can lock / unlock, rename, recolor or delete a locked layer; nobody can clear it.
- Deleting a layer deletes its elements (confirm shows count). Can't delete the last layer. "Clear layer" (kebab) removes its elements after a confirm ("An automatic snapshot will be saved first."): every clear of a non-empty layer first saves an auto snapshot of the whole board, so it can be undone by restoring it (F10). Clearing an empty layer saves nothing.
- Reorder changes rendering order (z of layer > z of element). The panel lists the **top-most layer first**.
- Layer ops (add, rename, recolor, visibility, lock, reorder, clear, delete) are not part of undo / redo in v1.

---

## F6. Drawing tools [DRAW-1…9]
Common behavior: tool creates a **draft** locally; others see a `stroke:preview` ghost (50 % opacity) for pen/line/arrow/circle/polygon while drawing; commit on finish → `element:upsert`. `Esc` cancels a draft.

| Tool | Interaction | Stored as | Notes |
|---|---|---|---|
| **Select (V)** | click to select, Shift+click multi, drag on empty map = pan, Shift+drag = marquee select; drag selected to move; circle shows radius handle; text double-click to edit | – | moving many elements → single `element:batch` on drop (chunked ≤ 50 ops) |
| **Pen (P)** | press-drag-release | STROKE | points sampled every ≥ 4 px screen distance, simplified (simplify-js, tolerance = 1.5 px in world units at current zoom), max 2 000 points (auto-commit and start a new stroke when exceeded) |
| **Line (L)** | press-drag-release | LINE | Shift snaps to 15° |
| **Arrow (A)** | click start, click bends, double-click / Enter to finish; or press-drag-release for a straight arrow | ARROW | max 50 points; head at last point; **double-headed** toggle (⟷) in the style bar (Phase 11): remembered per device for new arrows, and on a selection of arrows it flips them as one undoable edit — stored as `props.doubleHeaded: true`; **curved** toggle (∿, Phase 12, same two modes): a smooth curve through every bend (Catmull-Rom, 16 samples per bend), stored as `props.curved: true`; a straight two-point arrow is never marked curved. Rendering, heads, select / eraser hit-testing and thumbnails all use the same sampled curve |
| **Circle (C)** | press at center, drag radius, release; radius label in m | CIRCLE | Zone preset dropdown places a circle of that radius on click; Shift = draw from edge |
| **Polygon (G)** | click vertices, click first point or Enter to close; Backspace removes last vertex | POLYGON | min 3, max 200 vertices |
| **Text (T)** | click → inline input → Enter commits, Esc cancels | TEXT | 1–120 chars, sizes sm/md/lg |
| **Marker (M)** | pick kind from flyout (remembered), click to place; for enemy squad, number auto-increments (next unused 1–25) | MARKER | label editable via select → double-click |
| **Eraser (E)** | click an element or drag across elements to delete those touched | – | respects locks/roles; batch delete |
| **Measure (R)** | click points, double-click to finish; shows segment + total metres + travel time; Esc clears | – (local only) | Phase 11: Editor+ get **Save as line** in the style bar once a measure is finished — LINE elements on the active layer with the Line tool's style (a LINE has 2 points, so N points → N − 1 lines), one action / one undo step; the local measure is then cleared |
| **Laser (K)** | hold mouse button/finger to show a fading trail to everyone | – (ephemeral) | trail lifetime 1.5 s |

**Select details** (Phase 6)
- Hit priority: topmost on screen — layer order, then z (markers / text above vectors on ties); only shown, unlocked layers. Tolerance ≈ 6 px on screen around paths; markers hit inside their 28 px icon, text inside its label pill.
- Pressing an unselected element selects it (Shift adds), so a press-drag moves it straight away. A click on an already selected element of a multi-selection selects just that one. A press that pans (or moves < 3 px) on empty map clears the selection.
- Marquee (Shift+drag on empty map) is **additive**: it adds elements whose bounding box intersects it. Ctrl/Cmd+A selects every element of the active layer and switches to Select.
- While dragging, the move / resize is shown locally only; one batch is sent on release. A move is clamped so the whole selection stays on the map.
- Double-click edits a text's text or a marker's label inline (textContent only, same length limits as creation). Ctrl/Cmd+D duplicates with new ids, offset +2 000 cm on x and y (clamped to the map), as one batch; the copies become the selection.
- Viewers: Select only pans; nothing can be selected. Other users' selections are not shown in v1.

**Styles**
- Color, width S/M/L (2/4/7 px screen), dashed, fill opacity (0–60 %, closed shapes).
- Last-used style remembered per tool.
- Stroke width is screen-constant (doesn't scale with zoom); markers screen-constant 28 px.

**Undo / redo**
- Per user, 100 steps, session-only (not persisted across reloads).
- Undo of create → delete; of delete → re-create with same id; of update → previous values.
- If target changed by someone else since (seq mismatch) → skip + toast "Changed by {name}"; the rest of the step still applies, and only the applied part can be redone.
- One step per user action: a create, a batch move, an erase sweep, a delete / duplicate, one style-bar change, an inline text edit. Stacks are kept per board; a new action clears redo.

**Bulk operations** — the offline queue cap (500, ARCHITECTURE §7.4) counts **ops**, not actions. Online, bulk actions (multi-move, paste, eraser drag, group undo) are sent as `element:batch` messages of ≤ 50 ops. Offline, a bulk action that needs more ops than the queue has room for is **refused whole** with a toast ("Too many changes while offline — reconnect first"), never partially queued. `layer:clear` is a single op however many elements it removes.

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
| loot (Phase 12) | `#A855F7` | – | optional; plus an **item**: one of 80 PUBG item / care-package icons (style bar "Loot item", grouped Care packages / Weapons / Handguns / Throwables / Equipment / Melee; remembered for the next placement; changeable on a selected marker as one undoable edit) |
- Loot markers (Phase 12): a dark rounded badge in the marker colour with the item icon (24 px) on it; until the icon loads — or if it never does — a crate glyph shows instead. `props.item` is an id from `LOOT_ITEMS` (`packages/shared/src/loot.ts`), never a path or URL; the icon is `{tiles base}/icons/items/<id>.webp`. Export PNG draws the icon too. Names are the in-game ones (PUBG's file `HK416` → "M416").
- Hover tooltip: label + "placed by {user} · {time ago}".
- Own player markers can be linked to a member (P2, Phase 12): select one own-player marker → "Linked player" in the style bar (members by IGN, else display name; "Not linked"). The link is stored as `props.memberId` (one undoable edit; it replaces a typed label). The marker's label is resolved when drawn — that member's IGN, else display name — so it follows renames as soon as the room's member list refreshes; nothing name-like is stored. The server accepts only a current member of the room. A link to someone who left shows no label (the glyph still reads "P{n}") and the picker shows "Former member". Share links and `/explore` never receive the member id, so those viewers see "P{n}" only.

---

## F8. Realtime collaboration [RT-1…7]
- **Ephemeral events are best-effort**: cursors, laser, `stroke:preview` ghosts and follow-mode view updates may be dropped and are never replayed; the UI tolerates gaps (ghosts vanish after 3 s without updates, cursors fade).
- **Cursors**: shown only for users on the same board; name pill; hidden while user is idle > 5 s (fade) or follow mode active.
- **Presence**: online dot; idle (2 min no input) shows half-opacity avatar; board dots on tabs.
- **Follow**: follower's map mirrors leader's `center/zoom` with 200 ms smoothing; switching boards follows too. Any manual pan/zoom by follower exits follow mode (toast "Stopped following"). "Manual" = drag, wheel, double-click, pan/zoom keys, Space / middle-mouse pan, the HUD zoom / fit buttons, the minimap, or opening a ping chip; programmatic moves never count. A "Following {name} · Stop" pill sits at the top of the map; the follower's own cursor isn't broadcast meanwhile. The leader learns its follower count (`followers:update`) and sends `view:update` (≤ 10 Hz) only while it is > 0, plus at once when a follower joins or its new board is subscribed, and every 1.5 s as a resend (view updates are best-effort). Started from a presence avatar's menu (Follow / Go to their board). If the leader leaves the room or goes offline, followers stop with a toast "{name} left — stopped following".
- **Summon**: leader triggers (Editor+, own avatar → "Summon everyone"); each member starts following at once and gets a non-blocking toast "{name} is presenting — following" with a "Don't follow" button (5 s).
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
- Typing indicator (P2, Phase 11): "Rudra is typing…" / "A and B are typing…" / "Several people are typing…" above the input, for other members only. A client sends a volatile `chat:typing` at most every 2 s while the input has text; a name clears 4 s after its last event or when that person's message arrives. Best effort (volatile), not a live region.
- Pings must point at a board of this room and inside that board's map; anything else is `VALIDATION_ERROR` (no hint whether a board exists).
- Chat text: trimmed, NFC, control characters stripped except `\n`, 1–500 code points; shown as text only (no HTML, no auto-links). Viewers can chat and ping. Optimistic send with a pending state; a failed message offers Retry (same `clientId`, so never duplicated) or discard. Enter sends, Shift+Enter is a newline, a counter shows from 400 characters. Delete own messages (owner: any) from a hover menu.
- Unread badge counts other people's **user** messages that arrive while the chat isn't on screen (panel closed → on the panel toggle; another tab → on the Chat tab). System messages don't count.
- A ping on a board that was later deleted keeps its message; the chip shows disabled. Reduced motion: chips jump instantly and pulses don't animate (a still ring is shown).
- System messages: join, leave, kick, role change, board created/deleted, snapshot saved/restored.
- History: 50 per page, infinite scroll up; "Jump to latest" button when scrolled up and new messages arrive.
- Unread badge on Chat tab / FAB when panel hidden.

---

## F10. Snapshots [BOARD-5]
- Manual: name required (1–60 chars). Max 50 manual per board; at limit, oldest must be deleted by user.
- Auto: before every restore and before every `layer:clear` of a non-empty layer; max 10, oldest pruned.
- Preview renders snapshot data read-only in a modal map (same renderer).
- Restore is atomic and broadcast as `board:reset`. Element and layer ids are kept; every client reloads the board in full, clears its undo / redo stacks for it and shows "Board was restored by {name}"; the room gets a system message. A manual save also posts one.
- Drawer from the board tab's kebab (any member; saving / restoring Editor+; deleting the owner or the author). Clicking an item opens a read-only preview map (hover prefetches it).

---

## F11. Measure & study [STUDY-1]
- Distance = sum of segment lengths in metres (`world / 100`), shown with thin space thousands separator: `3 420 m`.
- Travel time: `distance / speed` using `SPEEDS` config, formatted `~9 min`. Always labelled "approx.".
- Optional P2: elevation is **not** available (no height data) — don't fake it.
- Tool (R), every role, local only: click points, double-click / Enter finishes, Backspace removes the last point, Esc clears; per-segment lengths at midpoints, total + "~N min on foot · ~N min by vehicle (approx.)" at the end.
- "Save as line" (Phase 11, Editor+, room only): see F6 — the same gating as drawing (locked / no layer / board full / queue full show the usual toast).

---

## F12. Export PNG [STUDY-2]
- Captures current viewport at device pixel ratio (max 2×): tiles + elements + optional grid; excludes cursors, selection, HUD.
- Adds a small footer strip: room · board · map · date · "PUBG map imagery © KRAFTON".
- Filename `{room-slug}_{board-slug}_{YYYY-MM-DD}.png`.
- Tiles must be served with `Access-Control-Allow-Origin` for the app origin so the canvas isn't tainted.
- From the ⋯ menu (every role). It is a canvas composite (tiles of the shown variant, grid lines + letters when shown, the element canvas, markers and text re-drawn) — no screenshot library. The measure line, cursors, selection, drafts, ghosts, laser and pulses are left out. The footer overlays the bottom 24 px, so the image is exactly viewport × DPR (E2E-11).

---

## F13. Demo / explore mode
- `/explore` loads the demo boards read-only without auth via `GET /api/v1/public/demo-boards` (rate-limited, cached 5 min). Board IDs come from env `DEMO_BOARD_IDS` (comma-separated, one per map).
- All tools except Measure disabled; map switcher swaps between three demo boards.
- Phase 9 details: one entry per map in map order — the first demo board of each, or the bare map when none is set up (a note says so). Labels / grid (HUD, N / Shift+G) and Measure (R; the room's MeasureTool) work; nothing else is offered and **no socket is opened**. CTA bar: "Create a free account to save your own boards". The server only ever serves ids from `DEMO_BOARD_IDS`, without room or author ids (API_SPEC §8).

---

## F14. Notifications & toasts
- Toasts for: role changed, kicked, board deleted (you were on it), snapshot restored, op rejected (with reason), offline/online.
- No email/push notifications in v1.
