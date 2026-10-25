# PRD — RotationLab

| Field | Value |
|---|---|
| Product | RotationLab — collaborative tactical map sandbox for BGMI / PUBG Mobile teams |
| Owner | Shivansh Saroha |
| Status | Draft v1.0 |
| Last updated | 2026-10-25 |

---

## 1. Problem

Competitive BGMI / PUBG Mobile squads plan drops and rotations today by screen-sharing a static map image on Discord, drawing in Paint, or talking over each other in voice. Plans are lost after the call, nobody can draw at the same time, enemy team spots are kept in someone's head, and newer players never learn the map properly.

## 2. Goal

Give a team **one shared, persistent, zoomable map** where everyone can draw, place markers and chat at the same time — and come back to the plan later.

### Success metrics (first 90 days after launch)
| Metric | Target |
|---|---|
| Rooms with ≥ 3 active members in one session | ≥ 40 % of created rooms |
| Median edit sync latency (client → other clients) | < 150 ms on same region |
| Boards revisited within 7 days | ≥ 30 % |
| Crash-free sessions | ≥ 99 % |

## 3. Target users

| Persona | Description | Main need |
|---|---|---|
| **IGL / Captain** | Calls drops and rotations for a 4-man squad | Draw plans fast, have the squad follow their view |
| **Squad player** | Plays scrims and tournaments | See the plan, add their own position, ask questions in chat |
| **Coach / Analyst** | Reviews scrims, prepares strategies | Multiple scenarios per map, enemy team mapping, saved snapshots |
| **Casual learner** | Wants to learn the maps | Explore maps, names on/off, grid, measure distances |

## 4. Scope

### 4.1 In scope — v1 (MVP)
1. **Accounts** — sign up, log in, log out, edit profile, change password, delete account.
2. **Rooms** — create, rename, delete; invite via link or code; optional room password; join; leave; kick; roles Owner / Editor / Viewer; max **16 members** per room.
3. **Maps** — Erangel, Miramar, Rondo from PUBG PC art; smooth pan/zoom; labelled / unlabelled base-layer toggle; grid overlay (8×8 km, 1 km squares); minimap.
4. **Boards** — each room holds up to **20 boards**; a board = one map + a set of layers + drawings. Create, rename, duplicate, delete, reorder.
5. **Layers** — up to 10 per board; show/hide, lock, rename, reorder, color.
6. **Drawing tools** — select/move, pen, line, arrow, circle, polygon, text, eraser, undo/redo, clear layer.
7. **Markers** — own squad, own players P1–P4, enemy squad (number 1–25 + color), vehicle, drop, danger, hold.
8. **Realtime collaboration** — all edits sync live; live cursors; laser pointer (temporary trail); follow-mode.
9. **Chat** — room-level text chat, map pings, message history (last 500 per room loaded with pagination).
10. **Measure tool** — distance in metres, estimated time on foot and by vehicle.
11. **Snapshots** — save named snapshot of a board, view and restore.
12. **Export** — PNG of current viewport with drawings.
13. **Responsive** — full use on desktop; view + chat + basic drawing on tablet; view + chat on phone.

### 4.2 Out of scope — v1 (see TODO.md for later)
- Voice chat (teams use Discord)
- Automatic zone simulator with real phase shrink logic
- PUBG API match replay / telemetry overlay
- Public room discovery / matchmaking
- Social login (Google/Discord) — planned v1.1
- Native mobile apps
- Sanhok, Vikendi and other maps — design must allow adding them by config only

## 5. Functional requirements

IDs are referenced in FEATURES.md, TESTING.md and TODO.md.

### Accounts (AUTH)
| ID | Requirement | Priority |
|---|---|---|
| AUTH-1 | User registers with email, unique username (3–20 chars, `a-z0-9_`), password (min 10 chars, checked against a breached-password list) | P0 |
| AUTH-2 | User logs in with email or username + password | P0 |
| AUTH-3 | Session persists 30 days via rotating refresh token; access token lifetime 15 min | P0 |
| AUTH-4 | Logout revokes current refresh token; "log out all devices" revokes all | P0 |
| AUTH-5 | Profile: display name, in-game name (IGN), avatar color | P1 |
| AUTH-6 | Change password (requires current password; revokes other sessions) | P1 |
| AUTH-7 | Email verification + password reset by email (behind `EMAIL_ENABLED` flag) | P1 |
| AUTH-8 | Delete account (anonymises chat, transfers or deletes owned rooms) | P1 |

### Rooms (ROOM)
| ID | Requirement | Priority |
|---|---|---|
| ROOM-1 | Logged-in user creates room with name (3–40 chars), optional description, optional password | P0 |
| ROOM-2 | Creator becomes Owner. Owner can make others Editor/Viewer, transfer ownership | P0 |
| ROOM-3 | Owner/Editor can generate invite link with expiry (1 h / 24 h / 7 d / never) and max uses; can revoke | P0 |
| ROOM-4 | Join via link or 10-char code; password prompted if set; new members join as Editor by default (configurable per room) | P0 |
| ROOM-5 | Member can leave; Owner can kick (kicked user is disconnected immediately) | P0 |
| ROOM-6 | Dashboard lists the user's rooms with online count and last activity | P0 |
| ROOM-7 | Owner can delete room (soft delete 7 days, then purge) | P1 |
| ROOM-8 | Owner can lock room (no new joins) | P2 |

### Maps & Boards (MAP / BOARD)
| ID | Requirement | Priority |
|---|---|---|
| MAP-1 | Show map tiles for selected map; zoom levels from full-map view to max tile resolution | P0 |
| MAP-2 | Toggle labelled / unlabelled art | P0 |
| MAP-3 | Grid overlay with column letters A–H and row letters I–P (verify against in-game map) | P0 |
| MAP-4 | Cursor coordinate readout as grid square + metres | P1 |
| MAP-5 | Minimap with viewport rectangle | P2 |
| BOARD-1 | Create board: name + map (Erangel / Miramar / Rondo) | P0 |
| BOARD-2 | Rename, duplicate, delete, reorder boards | P0 |
| BOARD-3 | Switching board keeps chat; each user can be on a different board; presence shows who is where | P0 |
| BOARD-4 | Layers: add, rename, color, hide, lock, reorder, delete (min 1 layer) | P0 |
| BOARD-5 | Snapshots: save (name), list, preview, restore (restore itself creates an auto-snapshot first) | P1 |

### Drawing (DRAW)
| ID | Requirement | Priority |
|---|---|---|
| DRAW-1 | Tools: select, pen, line, arrow, circle, polygon, text, marker, eraser, measure, laser | P0 |
| DRAW-2 | Style: color (palette of 10 + custom), stroke width (3 sizes), dashed toggle, fill opacity for closed shapes | P0 |
| DRAW-3 | Select, move, resize (circle radius), delete, change style of existing elements | P0 |
| DRAW-4 | Undo/redo per user, last 100 actions, only affects that user's own actions | P0 |
| DRAW-5 | Locked layers can't be edited; Viewers can't edit anything | P0 |
| DRAW-6 | Marker tools with label text (≤ 24 chars) | P0 |
| DRAW-7 | Keyboard shortcuts (see UI_UX_SPEC §8) | P1 |
| DRAW-8 | Zone circle presets — configurable list of phase radii per map | P1 |
| DRAW-9 | Max 5 000 elements per board; max 2 000 points per stroke | P0 |

### Realtime (RT)
| ID | Requirement | Priority |
|---|---|---|
| RT-1 | Element add/update/delete reaches other clients in < 150 ms p50, < 400 ms p95 (same region) | P0 |
| RT-2 | Live cursors with name + color, throttled to 20 Hz | P0 |
| RT-3 | Presence list: online members, which board they're on, idle state after 2 min | P0 |
| RT-4 | Laser pointer: trail visible to all for 1.5 s, never persisted | P1 |
| RT-5 | Follow mode: any user can follow another user's viewport; leader can "summon" all (everyone follows) | P1 |
| RT-6 | Reconnect: on network loss, client reconnects automatically and resyncs board state without losing local unsent edits | P0 |
| RT-7 | Conflict rule: last write wins per element by server sequence number | P0 |

### Chat (CHAT)
| ID | Requirement | Priority |
|---|---|---|
| CHAT-1 | Send text messages (≤ 500 chars) in room | P0 |
| CHAT-2 | Map ping: attach current cursor/selected location; message shows grid ref; click flies map there and shows a pulse | P0 |
| CHAT-3 | History with infinite scroll | P0 |
| CHAT-4 | System messages (joined, left, board created, snapshot restored) | P1 |
| CHAT-5 | Delete own message; Owner can delete any | P1 |
| CHAT-6 | Unread badge when chat panel is collapsed | P1 |

### Study (STUDY)
| ID | Requirement | Priority |
|---|---|---|
| STUDY-1 | Measure tool: polyline distance in metres; estimated time on foot and vehicle using configurable speeds | P1 |
| STUDY-2 | Export PNG of current view | P1 |

## 6. Non-functional requirements

| Category | Requirement |
|---|---|
| Performance | First map paint < 2.5 s on 4G for a cold load; 60 fps pan/zoom on a mid-range laptop with 1 000 elements |
| Scale (v1) | 500 concurrent users, 100 concurrent rooms on a single 2 vCPU / 4 GB VM |
| Availability | 99.5 % monthly |
| Security | OWASP ASVS L1 baseline; see SECURITY.md |
| Accessibility | WCAG 2.2 AA for non-map UI; all tools reachable by keyboard |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari; Android Chrome; iOS Safari 17+ |
| Privacy | Store minimum data; account deletion within 30 days; no third-party trackers by default |
| Localisation | English UI v1; strings in a single i18n file to allow Hindi later |

## 7. Assumptions and constraints
- Map art comes from the PUBG `api-assets` repo and is used under PUBG's Terms of Use (see README §5). Non-commercial.
- PUBG world size for 8×8 km maps is 816 000 cm per side; all three v1 maps are 8×8 km. Verify Rondo's size before release.
- PC map art can differ slightly from BGMI; the UI shows a one-line notice.

## 8. Open questions
1. Should joining via invite default to Editor or Viewer? (Default: Editor; owner can change room default.)
2. Is 16 members per room right for a team + coaches + subs? (Configurable via env.)
3. Do we need public read-only share links for boards (e.g. post a plan on Discord)? Candidate for v1.1.
