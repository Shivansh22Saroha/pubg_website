# UI / UX SPEC — RotationLab

## 1. Design direction
**"Tactical HUD."** Dark, calm, high-contrast UI that gets out of the way of the map. Panels feel like an in-game overlay: thin borders, slight translucency over the map, amber accent borrowed from battle-royale HUDs, monospace numbers for coordinates. No glossy gradients, no neon overload.

Principles
1. **Map first** — the map occupies ≥ 70 % of the screen on desktop. Panels collapse.
2. **One-click tools** — every common action ≤ 1 click or 1 key.
3. **Who did what is visible** — each user has a color used for cursor, avatar ring and selection outline.
4. **Never lose work** — saving is automatic; show a sync indicator, never a "Save" button.

## 2. Design tokens

### 2.1 Colors (dark theme — default and only theme in v1)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#090C11` | app background |
| `--surface` | `#10151C` | cards, panels |
| `--surface-2` | `#161D26` | hovered rows, secondary fills |
| `--surface-3` | `#1C2531` | hover on toolbar buttons, disabled primary buttons |
| `--overlay` | `rgba(13,18,25,0.78)` + `backdrop-blur: 14px` (the `glass` utility) | chrome floating over the map: HUD, minimap, style bar, menus |
| `--border` | `#222C39` | 1 px borders, dividers |
| `--border-strong` | `#324154` | dialogs, glass edges, input hover |
| `--highlight` | `rgba(255,255,255,0.06)` | 1 px inset top highlight on raised surfaces |
| `--text` | `#E8EDF2` | primary text |
| `--text-muted` | `#8E9AAB` | secondary text, placeholders |
| `--accent` | `#F5B301` | primary buttons, active tool, focus ring |
| `--accent-hi` | `#FFCB3D` | top of the accent gradient on primary buttons and the active tool |
| `--accent-glow` | `rgba(245,179,1,0.28)` | input focus ring, soft glow under primary buttons |
| `--accent-fg` | `#111111` | text on accent |
| `--success` | `#22C55E` | online dot, synced |
| `--warning` | `#F59E0B` | reconnecting |
| `--danger` | `#EF4444` | destructive, enemy default |
| `--info` | `#38BDF8` | pings, links |

Contrast: text on `--surface` ≥ 7:1; muted text ≥ 4.5:1 (≈ 6.4:1 after the 2026-11 premium pass). Focus ring: 2 px `--accent` + 2 px offset; text inputs use a 3 px `--accent-glow` ring instead.

**BGMI theme (2026-11, supersedes the values above where they differ):** true-black base `--bg #050505`, neutral greys `--surface #0E0E0E` / `--surface-2 #161616` / `--surface-3 #1F1F1F`, borders `#262626` / `#3B3B3B`, text `#F5F5F5`, muted `#A3A3A3` (7.6:1 on surface), accent = BGMI gold `#FFB400` (hi `#FFC933`), `--accent-fg #0A0A0A` (11:1 on gold). The game site's look, with RotationLab's own name and mark — never the BGMI / KRAFTON logos or wordmark. Utilities: `bgmi-cut` (bottom-right corner clipped off; focus is an inset double ring because clip-path cuts outlines), `bgmi-halftone` (flat gold with a halftone fade into the right edge), `bgmi-dots` (halftone texture for black bands).

Surfaces (premium pass): `surface-raised` (cards, side panels: surface + border + inset highlight) and `glass` (anything floating over the map). Section labels are sentence case, not all caps. Radius: 8 px controls, 12 px panels, 18 px hero surfaces (dialogs, landing frames).

### 2.2 Drawing palette (10 swatches, in order)
`#F2A900` amber · `#EF4444` red · `#F97316` orange · `#FACC15` yellow · `#22C55E` green · `#14B8A6` teal · `#38BDF8` sky · `#6366F1` indigo · `#EC4899` pink · `#F8FAFC` white
+ custom color picker. Defaults: own-team markers = `#38BDF8`, enemy = `#EF4444`, zone circle = `#F8FAFC` dashed.

User presence colors: assigned from a separate 12-color list, never the same as another online user in the room.

### 2.3 Typography
| Role | Font | Size / weight |
|---|---|---|
| Display / headings | **Teko** (Google Fonts; was Rajdhani until the 2026-11 BGMI theme) | always uppercase (`.font-display`), letter-spacing 0.02em; condensed, so sizes run larger: landing H1 124/700, section H2 64/700, nav 21/600, buttons 17–26/600; section labels uppercase 0.04em |
| Body / UI | **Inter** | 14/400 body, 13/500 controls, 12/500 captions |
| Numbers / coords | **JetBrains Mono** | 12/500 |

### 2.4 Spacing, radius, elevation
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48.
- Radius: 6 px controls, 10 px panels/cards, full for avatars/pills.
- Shadows: only on floating panels — `0 8px 24px rgba(0,0,0,0.45)`.
- Motion: 150 ms ease-out for hovers/panels; 300 ms for map fly-to; respect `prefers-reduced-motion` (disable pulses, use instant jumps).

### 2.5 Icons & buttons
`lucide-react`, 18 px in toolbars, 16 px inline. Custom SVG marker set (see §6.4).
Buttons (BGMI theme): **accent** = gold plate — `bgmi-cut` + `bgmi-halftone`, square corners, Teko caps; **outline** = store-badge style — black, 1.5 px light border, 8 px radius, Teko caps, gold on hover; **ghost** / **destructive** unchanged.

## 3. Screens

### 3.1 Landing `/`
- Top nav: logo (left), "Log in" ghost button, "Get started" accent button. *BGMI theme:* a solid black 64 px bar — wordmark, caps nav links (Explore · Erangel · Miramar · Rondo, ≥ 1024 px), "Log in" as a caps link, and "Get started" / "Go to dashboard" as a full-height gold block flush with the right edge.
- Hero: H1 "Plan your rotations together.", subtitle one line, primary CTA "Create a room", secondary "Explore maps" (opens a read-only demo board, no login). *BGMI theme:* centred like a game title card — the H1 in three caps lines inside a heavy white frame over the darkened Erangel art (radial vignette), the two CTAs below it (gold plate + black badge), the legend in caps.
- Below: 3 feature cards (Live drawing · Map pings in chat · Erangel, Miramar, Rondo) with a short looping screen recording or static screenshot each.
- Footer: attribution line (PUBG/KRAFTON notice), Privacy, Terms, GitHub.

### 3.2 Auth `/login`, `/register`, `/forgot-password`, `/reset-password`
- Centered card 400 px wide on `--bg` with a blurred, darkened map image behind.
- Register fields: Email, Username (live availability check, debounced 400 ms), Password (strength meter + rules list), Confirm password.
- Login: "Email or username", Password, "Show password" toggle, "Forgot password?" link.
- Errors inline under fields; generic message for bad credentials ("Email/username or password is incorrect").
- Submit button shows spinner and is disabled during request.

### 3.3 Dashboard `/dashboard`
```
┌────────────────────────────────────────────────────────────────┐
│ ▣ RotationLab         [ Search rooms… ]         ( + New room ) ◉│
├────────────────────────────────────────────────────────────────┤
│  Your rooms                                       Join with code│
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  [ ________ ]│
│ │ map thumb    │ │ map thumb    │ │ map thumb    │  ( Join )    │
│ │ Team Soul ★  │ │ Scrim prep   │ │ …            │              │
│ │ ●3 online    │ │ ●0 · 2h ago  │ │              │              │
│ │ Owner · 6 brd│ │ Editor       │ │              │              │
│ └──────────────┘ └──────────────┘ └──────────────┘              │
└────────────────────────────────────────────────────────────────┘
```
- Room card: thumbnail of the room's most recently edited board, name, your role badge, online count (green dot), last activity, board count. Click → room. Kebab menu: Rename, Invite, Leave / Delete.
- Empty state: illustration + "No rooms yet" + "Create your first room" button + "Have an invite code?" input.
- "New room" dialog: Name, Description (optional), Password (optional toggle), First board map (3 thumbnail radio cards: Erangel / Miramar / Rondo), Default role for new members (Editor/Viewer).

### 3.4 Join `/join/[code]`
Card showing room name, owner, member count, map thumbnails. If not logged in → login/register with redirect back. If password-protected → password field. Button "Join room".

### 3.5 Room workspace `/rooms/[roomId]` ⭐ (main screen)

Desktop ≥ 1280 px:
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Team Soul ▾ │ [Erangel – Drop A ×][Miramar – Pecado][+] │ ◉◉◉+2 │ Invite │ ⚙ │ ● Synced │
├────┬──────────────────────────────────────────────────────────┬───────────────┤
│ ▲  │                                                          │ Chat│Layers│Mem│
│ ✎  │                                                          │───────────────│
│ ╱  │                         MAP                              │ Rudra 12:01   │
│ →  │          (Leaflet, full bleed, cursors visible)          │ go school 📍F-M│
│ ○  │                                                          │               │
│ ⬠  │                                                          │               │
│ T  │                                                          │               │
│ 📍 │                                                          │               │
│ ⌫  │   ┌──────────────────────────────────────┐               │               │
│ 📏 │   │ ● ● ● ● ● ● ● ● ● ●  ━ ━━ ━━━  ┄  ▢50%│ style bar    │ [msg…   ]📍 ➤ │
│ ✦  │   └──────────────────────────────────────┘               │               │
│ ↶↷ │ F-M 4,7 · 3 412 m, 5 120 m           [labels ◐][grid #][ – + ][⤢]       │
└────┴──────────────────────────────────────────────────────────┴───────────────┘
 56px                        flexible                              340px
```

**Top bar (48 px)**
- Back to dashboard, room name with dropdown (room settings, copy invite, leave).
- **Board tabs**: tab label = board name, small map icon; active tab underlined with `--accent`; small avatar dots on a tab show who is on that board; `+` opens "New board" (name + map picker); right-click/kebab: rename, duplicate, delete, snapshots.
- **Presence stack**: up to 5 avatars (colored ring = presence color), `+N`. Click avatar → menu: Follow, Go to their board.
- **Invite** button (accent outline) → Invite dialog.
- **Sync indicator**: `● Synced` (green) / `◌ Saving…` (muted) / `▲ Reconnecting…` (amber) / `✕ Offline — changes will sync` (red).

**Left toolbar (56 px, vertical)** — buttons 40×40, tooltip with name + shortcut on hover:
Select (V) · Pen (P) · Line (L) · Arrow (A) · Circle (C) · Polygon (G) · Text (T) · Marker (M, opens marker picker flyout) · Eraser (E) · Measure (R) · Laser (K) · — · Undo (Ctrl+Z) · Redo (Ctrl+Shift+Z).
Active tool: `--accent` background, `--accent-fg` icon. Viewers see only Select, Measure, Laser. Until Measure (Phase 8) and Laser (Phase 7) exist, their buttons are shown disabled with a "coming in a later update" tooltip. Undo / Redo are disabled while their stack is empty and hidden for viewers.

**Style bar** (floating, bottom-center of map, appears when a drawing tool or a selection is active): palette swatches, custom color, stroke width (S/M/L = 2/4/7 px), dashed toggle, fill opacity slider (closed shapes), for circle tool a "Zone presets ▾" dropdown; for the arrow tool (and a selection containing arrows) a "Double-headed" ⟷ toggle (Phase 11) and a "Curved" ∿ toggle (Phase 12). With a selection: also Delete and "Move to layer ▾". With the Measure tool and a finished measure, Editors see "Save as line" (Phase 11).

**Map HUD (bottom)**: left — cursor grid ref + world metres (mono font); right — labels toggle (◐), grid toggle (#), zoom −/+, fit map (⤢). Minimap (P2, Phase 11) bottom-right above the HUD controls, 160×160, collapsible (header "Minimap" ▾, remembered per device): the map's low-res image with the view rectangle in `--accent`; click or drag moves the view, arrow keys pan by 1/10 of the map while it has focus. Room, `/explore` and `/s/[token]`; never on phones (< 768 px); not part of PNG export.

**Right panel (340 px, collapsible to 0 with `]`)**, three tabs:
- *Chat* (the default tab): message list (avatar, name in presence color, time, text; pings render as a chip `📍 F-M 4,7 · Erangel – Drop A`), system messages centered muted; input with 📍 ping button and send; Enter sends, Shift+Enter newline; char counter after 400. A ping chip in the input is removable (×). Unread badge on the Chat tab, or on the panel toggle while the panel is closed.
- *Layers*: list of layers, **top-most first** (drag handle, color dot, name + element count, eye toggle, lock toggle, kebab: rename / color / clear layer / delete); "+ Add layer" (≤ 10); active layer highlighted — click a row to make it active; new elements go to the active layer. Eye: board-wide visibility (Editor+); Alt+click hides it for you only (closed-eye icon in the accent colour). Lock: a button for the owner, a read-only icon for everyone else. Delete and Clear ask for confirmation and show the element count.
- *Members*: online first, then offline; role badge; Owner sees role dropdown + Kick.

### 3.6 Room settings (dialog)
Tabs: General (name, description, default role), Security (password set/clear, lock room), Danger zone (transfer ownership, delete room — type room name to confirm).

### 3.7 Invite dialog
Current invite link with Copy button, code shown in large mono (`7KQ2-M9XF-AP`), expiry select, max uses, "Generate new link", list of active invites with Revoke.

### 3.8 Snapshots drawer
Right-side drawer: list (name, author, time, element count), preview thumbnail on hover, "Save snapshot", per-item "Restore" (confirm dialog: "Current board will be auto-saved first").

### 3.9 Settings `/settings`
Profile (display name, IGN, avatar color), Account (email, change password), Sessions (list devices, log out all), Danger (delete account).

### 3.10 Spotter — built-in help bot (2026-11)
A free FAQ bot on every page: no server, no AI, no key. It answers how to use RotationLab and BGMI basics (drops per map, rotations, zone play, vehicles, bridges, compounds, final circles, utility, loot, scrim prep) from `lib/spotter/knowledge.ts` (~45 intents) matched by `lib/spotter/match.ts` (normalise → synonyms + light stemming → weighted keywords: map names 5, an intent's two subject keywords 2, others 1; verbatim phrases +4; below 2 it says "I don't know that one yet" and offers suggestions).
- Launcher: gold "Ask Spotter" plate bottom-right (map pages `/explore`, `/maps/*`, `/s/*`: top-right below the header, icon-only on phones). In the room, a binoculars button in the top bar (and "Ask Spotter" in the phone menu) — the map's corners are taken.
- Panel: non-modal `role="dialog"`, 380 px (full width on phones), gold header, a `role="log"` conversation on black halftone, suggestion chips under each answer, optional internal link, input "Your question" (max 200 chars). Answers render as plain text only. A 420 ms typing beat (none under reduced motion). Esc closes only while focus is inside (on the map Esc belongs to the tools); focus returns to the opener. The conversation survives close / reopen until a reload. The panel and knowledge base load on first open (`next/dynamic`).

## 4. Components (shadcn/ui based)
Button (variants: accent, outline, ghost, destructive; sizes sm/md/icon), Input, Textarea, Select, Dialog, Drawer/Sheet, DropdownMenu, Tabs, Tooltip, Toast (sonner), Avatar, Badge, Switch, Slider, Popover, Separator, ScrollArea, Skeleton.

Custom: `ToolButton`, `ColorSwatch`, `BoardTab`, `PresenceAvatar`, `SyncIndicator`, `MapPingChip`, `MarkerPicker`, `LayerRow`, `RoleBadge`, `MapThumbCard`.

## 5. Map canvas behavior
- Scroll/pinch to zoom, drag to pan (in Select tool on empty space, or middle-mouse / Space+drag in any tool).
- Zoom snaps to 0.5 steps; double-click zooms in (disabled while drawing polygon).
- Cursor changes per tool (crosshair for drawing, cell for marker, not-allowed on locked layer).
- Other users' cursors: arrow icon in presence color + name pill; fade after 5 s idle.
- Map fly-to for pings: 300 ms, then a 3-pulse ring (1.2 s) at target.
- Labels toggle swaps tile layers instantly (both variants preloaded at current zoom).

## 6. Drawing element visuals
| Element | Visual |
|---|---|
| Pen stroke | smoothed polyline (Catmull-Rom or simplify-js tolerance 1.5 px at current zoom) |
| Line | straight, optional dashed |
| Arrow | line + filled arrowhead sized relative to stroke width; supports multi-point (click to add bends, double-click/Enter to finish) — main rotation tool |
| Circle | outline + optional fill (default 10 %); radius label in metres while drawing |
| Polygon | click points, close by clicking first point or Enter; fill default 15 % |
| Text | world-anchored label, 14 px, background pill `rgba(0,0,0,0.6)`; scales with zoom between 0.75× and 1.5× then clamps |
| Selection | 1.5 px dashed outline in your presence color + handles (circle: radius handle) |

### 6.4 Marker set (custom SVG, 28 px, constant screen size)
| Marker | Shape |
|---|---|
| Own squad | shield with team initials, sky blue |
| Own player P1–P4 | circle with number, sky blue |
| Enemy squad | diamond with team number (1–25), red default, color editable |
| Vehicle | car silhouette (from PUBG `Assets/Vehicle` later) |
| Drop | parachute |
| Danger | warning triangle |
| Hold / compound | house with flag |
| Generic pin | map pin |
Each marker has an optional label (≤ 24 chars) shown under it.

## 7. Responsive behavior
| Breakpoint | Layout |
|---|---|
| ≥ 1280 px | full layout as §3.5 |
| 1024–1279 | right panel 300 px, collapsed by default; toolbar unchanged |
| 768–1023 (tablet) | toolbar becomes bottom horizontal bar (scrollable); right panel becomes bottom sheet (half-height) toggled by a chat FAB; touch drawing supported (Pen/Pencil, circle, arrow, marker) |
| < 768 (phone) | **view + chat mode**: map full screen, board switcher as a dropdown, chat as full-screen sheet, tools limited to Select, Marker, Laser, Measure; banner "Use a larger screen for full drawing tools" |

Touch: one finger draws in drawing tools, two fingers always pan/zoom. Long-press = context menu.

Implementation notes (Phase 9):
- Breakpoints are read from the window width (`useBreakpoint`). Compact: the panel starts collapsed. Tablet: **every** tool of the role (the listed ones are the ones verified with touch), the panel as a half-height sheet above the bottom toolbar, the style bar right above the toolbar. Phone: Select, Marker, Measure, Laser (a viewer keeps Select, Measure, Laser), undo / redo for editors, a dismissible banner, the board dropdown, and one top-bar menu: Invite, Members, Chat, Snapshots…, Export PNG, Room settings, Leave. The chat button (with the unread count) sits at the top right of the map on both touch layouts.
- Leaving the room desktop-wide → touch-wide closes the panel; a tool the new layout doesn't offer falls back to Select.
- Long-press (Select, one finger held 500 ms within 10 px) on an editable element selects it and opens Edit label / Edit text (markers, text) and Delete; the OS long-press menu is suppressed on the map.
- Touch targets ≥ 44 px via `pointer: coarse` (buttons, menu items, tabs, tool buttons); hover-only actions (chat message options) are always shown on touch.

## 8. Keyboard shortcuts
| Key | Action |
|---|---|
| V P L A C G T M E R K | tools (see §3.5) |
| Ctrl/Cmd + Z / Shift+Z (or Y) | undo / redo |
| Delete / Backspace | delete selection |
| Ctrl/Cmd + D | duplicate selection |
| Ctrl/Cmd + A | select all on active layer |
| Esc | cancel current drawing / clear selection |
| Space (hold) | temporary pan |
| Enter | finish polygon / arrow |
| Shift (while drawing) | snap line to 15° / circle from center |
| 1 – 9 | switch board tab |
| G (with Shift) | toggle grid |
| N | toggle map labels |
| / | focus chat input |
| \] | toggle right panel |
| ? | shortcut help dialog |

Shortcuts disabled while focus is in an input, a dialog or a menu. On macOS the modifier is Cmd; Ctrl+Y (redo) works everywhere. While a drawing tool is busy, Enter / Esc / Backspace go to the tool first (finish, cancel, remove last polygon vertex).

## 9. States & feedback
- **Loading**: skeleton cards on dashboard; on room load show low-res map preview (819 px image) blurred → crisp tiles.
- **Empty board**: center hint "Pick a tool on the left and start drawing. Press ? for shortcuts." (touch layouts: "Pick a tool below and start drawing.")
- **Locked layer**: lock icon cursor + toast once "Layer is locked".
- **Viewer**: toolbar shows only allowed tools; banner in style bar area "View only — ask the owner for edit access".
- **Kicked / room deleted**: modal "You were removed from this room" → button to dashboard.
- **Reconnecting**: sync indicator amber, drawing still allowed (queued).
- Toasts bottom-left, max 3, auto-dismiss 4 s.

### 9.1 Motion library (2026-11)
Every animation answers something a person did; nothing loops while the tab is idle. All of it is off under `prefers-reduced-motion`.
- **Teammates' drawings arrive with an entrance** (only things someone *else* drew; never on the board's first load, a board switch, a reset, or a batch of more than 12): lines, strokes and arrows trace themselves along their path (650 ms); circles close in from 1.35× like a shrinking zone (750 ms); polygons fade in (450 ms). The canvas can't animate, so a short-lived SVG copy plays on the `elements-fx` pane while the real element is hidden, then hands back.
- **Markers land** for everyone, the placer included: drop markers parachute in with a dust ring, enemy squads pop and shake with a red ring, every other kind pops. A server ack that changes nothing visible keeps the layer, so the entrance isn't cut off.
- **Cursors glide** between their 20 Hz updates (110 ms linear).
- **Pings** have a third ring.
- **Sync indicator**: one green pulse each time changes land (the dot), a spinner while reconnecting; saving and offline keep their glyphs. Text labels are unchanged.
- **Board switch**: the new board wipes in from the left (420 ms clip-path).
- **Snapshot restore**: a rewind mark spins once over the map, alongside the existing toast.
- **Waking the server**: any request pending for over 2.5 s shows a bottom-centre card with a radar sweep — "Waking the server… It naps when nobody is planning. Up to 30 s." (free hosting sleeps when idle). It never takes clicks.
- E2E runs with reduced motion (the animations cost real CPU in software-rendered headless Chrome and move marker boxes while tests measure them); `motion.spec.ts` and the ping fly-to test opt back in.

## 10. Accessibility
- All toolbar buttons have `aria-label` + `aria-pressed`.
- Panels are landmark regions; tab order: top bar → toolbar → map → right panel.
- Chat list `aria-live="polite"` for new messages (throttled).
- Color is never the only signal: markers have icons/numbers, sync state has text.
- Map element list view (P2): a table of elements for screen-reader users, with delete/select actions.
- Phase 9: the element list is built — Layers tab → "List": type, label, layer, author; Select / Delete (Editor+, unlocked layers), 100 rows at a time. Phase 12: two columns so it fits the 300 px panel — the element (type + label) over a muted line "location · layer · author", then icon buttons Show / Select / Delete (28 px, 44 px on touch; their accessible names say what and where, e.g. "Show Marker Enemy squad 3 at F-K 4,8 on the map"). The location is the grid ref of the element's anchor — marker / text position, circle centre, else the centre of its points) and **Show** for every role, viewers included, which centres the map on the element like a ping chip (a manual move: it ends follow mode). Board tabs: a `tablist` may only own tabs, so the board actions (Snapshots…, Rename, Duplicate, Delete) are one "⋮" menu for the **active** board right after the tabs, and "+ New board" after it. Labelled status dots / badges use `role="img"`. Destructive buttons use `#DC2626` behind white text (4.8:1; `#EF4444` is 3.8:1). `prefers-reduced-motion` also turns off Leaflet's zoom / fade animations and makes follow mode jump instead of glide. E2E-13 scans with the WCAG 2.0–2.2 A / AA tags.
