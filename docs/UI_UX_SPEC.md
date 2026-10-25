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
| `--bg` | `#0B0F14` | app background |
| `--surface` | `#121821` | cards, panels |
| `--surface-2` | `#18202B` | inputs, hovered rows |
| `--overlay` | `rgba(18,24,33,0.88)` + `backdrop-blur: 8px` | panels floating over the map |
| `--border` | `#263241` | 1 px borders, dividers |
| `--text` | `#E6EDF3` | primary text |
| `--text-muted` | `#8B98A9` | secondary text, placeholders |
| `--accent` | `#F2A900` | primary buttons, active tool, focus ring |
| `--accent-fg` | `#111111` | text on accent |
| `--success` | `#22C55E` | online dot, synced |
| `--warning` | `#F59E0B` | reconnecting |
| `--danger` | `#EF4444` | destructive, enemy default |
| `--info` | `#38BDF8` | pings, links |

Contrast: text on `--surface` ≥ 7:1; muted text ≥ 4.5:1. Focus ring: 2 px `--accent` + 2 px offset.

### 2.2 Drawing palette (10 swatches, in order)
`#F2A900` amber · `#EF4444` red · `#F97316` orange · `#FACC15` yellow · `#22C55E` green · `#14B8A6` teal · `#38BDF8` sky · `#6366F1` indigo · `#EC4899` pink · `#F8FAFC` white
+ custom color picker. Defaults: own-team markers = `#38BDF8`, enemy = `#EF4444`, zone circle = `#F8FAFC` dashed.

User presence colors: assigned from a separate 12-color list, never the same as another online user in the room.

### 2.3 Typography
| Role | Font | Size / weight |
|---|---|---|
| Display / headings | **Rajdhani** (Google Fonts) | H1 32/700, H2 24/700, H3 18/600, uppercase letter-spacing 0.04em for section labels |
| Body / UI | **Inter** | 14/400 body, 13/500 controls, 12/500 captions |
| Numbers / coords | **JetBrains Mono** | 12/500 |

### 2.4 Spacing, radius, elevation
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48.
- Radius: 6 px controls, 10 px panels/cards, full for avatars/pills.
- Shadows: only on floating panels — `0 8px 24px rgba(0,0,0,0.45)`.
- Motion: 150 ms ease-out for hovers/panels; 300 ms for map fly-to; respect `prefers-reduced-motion` (disable pulses, use instant jumps).

### 2.5 Icons
`lucide-react`, 18 px in toolbars, 16 px inline. Custom SVG marker set (see §6.4).

## 3. Screens

### 3.1 Landing `/`
- Top nav: logo (left), "Log in" ghost button, "Get started" accent button.
- Hero: H1 "Plan your rotations together.", subtitle one line, primary CTA "Create a room", secondary "Explore maps" (opens a read-only demo board, no login).
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
Active tool: `--accent` background, `--accent-fg` icon. Viewers see only Select, Measure, Laser.

**Style bar** (floating, bottom-center of map, appears when a drawing tool or a selection is active): palette swatches, custom color, stroke width (S/M/L = 2/4/7 px), dashed toggle, fill opacity slider (closed shapes), for circle tool a "Zone presets ▾" dropdown. With a selection: also Delete and "Move to layer ▾".

**Map HUD (bottom)**: left — cursor grid ref + world metres (mono font); right — labels toggle (◐), grid toggle (#), zoom −/+, fit map (⤢). Minimap (P2) bottom-right 160×160, collapsible.

**Right panel (340 px, collapsible to 0 with `]`)**, three tabs:
- *Chat*: message list (avatar, name in presence color, time, text; pings render as a chip `📍 F-M 4,7 · Erangel – Drop A`), system messages centered muted; input with 📍 ping button and send; Enter sends, Shift+Enter newline; char counter after 400.
- *Layers*: list of layers (drag handle, color dot, name, eye toggle, lock toggle, kebab: rename/color/delete); "+ Add layer"; active layer highlighted — new elements go to active layer.
- *Members*: online first, then offline; role badge; Owner sees role dropdown + Kick.

### 3.6 Room settings (dialog)
Tabs: General (name, description, default role), Security (password set/clear, lock room), Danger zone (transfer ownership, delete room — type room name to confirm).

### 3.7 Invite dialog
Current invite link with Copy button, code shown in large mono (`7KQ2-M9XF-AP`), expiry select, max uses, "Generate new link", list of active invites with Revoke.

### 3.8 Snapshots drawer
Right-side drawer: list (name, author, time, element count), preview thumbnail on hover, "Save snapshot", per-item "Restore" (confirm dialog: "Current board will be auto-saved first").

### 3.9 Settings `/settings`
Profile (display name, IGN, avatar color), Account (email, change password), Sessions (list devices, log out all), Danger (delete account).

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

Shortcuts disabled while focus is in an input.

## 9. States & feedback
- **Loading**: skeleton cards on dashboard; on room load show low-res map preview (819 px image) blurred → crisp tiles.
- **Empty board**: center hint "Pick a tool on the left and start drawing. Press ? for shortcuts."
- **Locked layer**: lock icon cursor + toast once "Layer is locked".
- **Viewer**: toolbar shows only allowed tools; banner in style bar area "View only — ask the owner for edit access".
- **Kicked / room deleted**: modal "You were removed from this room" → button to dashboard.
- **Reconnecting**: sync indicator amber, drawing still allowed (queued).
- Toasts bottom-left, max 3, auto-dismiss 4 s.

## 10. Accessibility
- All toolbar buttons have `aria-label` + `aria-pressed`.
- Panels are landmark regions; tab order: top bar → toolbar → map → right panel.
- Chat list `aria-live="polite"` for new messages (throttled).
- Color is never the only signal: markers have icons/numbers, sync state has text.
- Map element list view (P2): a table of elements for screen-reader users, with delete/select actions.
