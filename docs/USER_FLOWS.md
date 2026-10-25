# USER FLOWS — RotationLab

Notation: **[Screen]**, `action`, → result. Each flow lists happy path, then alternate/error paths. Flow IDs are used in TESTING.md E2E cases.

---

## UF-1 Sign up
1. **[Landing]** `click "Get started"` → **[Register]**.
2. Enter email, username (availability check shows ✓/✗ after 400 ms), password (strength meter), confirm.
3. `Submit` → account created, cookies set → redirect to **[Dashboard]** (or to `redirectTo` if coming from an invite).
4. Toast "Welcome, {displayName}!". If `EMAIL_ENABLED`, banner "Verify your email" (non-blocking).

Alternates
- Username taken → inline error, suggestions (`name_1`, `name_gg`).
- Email taken → generic "Could not create account with these details" + link to log in (avoid strong enumeration; acceptable trade-off documented).
- Weak/breached password → inline rules list turns red.
- Rate limited → "Too many attempts, try again in N min".

## UF-2 Log in / log out
1. **[Login]** enter email-or-username + password → `Log in`.
2. Success → **[Dashboard]**.
3. Log out: avatar menu → `Log out` → cookies cleared → **[Landing]**.

Alternates
- Wrong credentials → "Email/username or password is incorrect".
- 5 failures → "Account temporarily locked. Try again in 15 minutes."
- Session expired while using app → silent refresh; if refresh fails → modal "Session expired" → **[Login]** with `redirectTo` current page; unsent board ops are kept in memory and re-sent after re-login (same tab).

## UF-3 Create a room (IGL)
1. **[Dashboard]** `+ New room`.
2. Dialog: name "Team Soul Scrims", optional description, optional password, pick first map (Erangel), default role (Editor).
3. `Create` → **[Room workspace]** opens on board "Erangel – Plan 1" with layers *Plan*, *Enemies*, *Zones*.
4. First-time coach-mark tour (3 steps): toolbar → board tabs → Invite button. Dismissible, remembered.

## UF-4 Invite teammates
1. **[Room]** `Invite` → dialog shows link `https://app…/join/7KQ2M9XFAP` and code.
2. Optionally change expiry (24 h default) / max uses / role → `Generate new link`.
3. `Copy` → paste in team Discord/WhatsApp.

## UF-5 Join a room via invite
1. Teammate opens link → **[Join]** shows room name, owner, members, maps.
2. Not logged in → `Log in to join` → **[Login/Register]** → returns to **[Join]**.
3. If room has password → enter password.
4. `Join room` → **[Room workspace]**; everyone else sees system chat message "rudra joined" and avatar appears.

Alternates
- Invite expired / revoked / max uses → "This invite is no longer valid. Ask for a new link."
- Room full → "Room is full (16/16)".
- Room locked → "Room isn't accepting new members".
- Already a member → straight into the room.
- Join with code: **[Dashboard]** "Join with code" input → same as step 3.

## UF-6 Plan a drop & rotation (core loop)
1. IGL on board "Erangel – Plan 1", `N` to hide labels to study terrain, `Shift+G` grid on.
2. Picks **Marker → Drop**, clicks School → drop marker appears for everyone instantly.
3. **Circle** tool, Zone preset "Phase 2" (or drag), places expected zone; label shows radius in m.
4. **Arrow** tool, clicks School → Rozhok → ridge → double-click → rotation arrow drawn (amber).
5. Teammate on same board adds **Own player P2** marker at the ridge compound and types in chat "I'll hold this" + 📍 ping.
6. IGL clicks the ping chip → map flies to it with pulse.
7. Coach toggles **Layers → Enemies**, places 3 enemy squad markers (numbers 4, 11, 17, red) with labels.
8. IGL `Save snapshot` "Plan A – north zone".

Alternates
- Two users move the same marker at the same time → last write (higher seq) wins; the other user's view snaps to final position (no error).
- Viewer tries to draw → only Select/Measure/Laser available; banner "View only".
- Layer locked → cursor not-allowed, toast "Layer is locked".

## UF-7 Scenario branching (multiple boards)
1. Board tab kebab → `Duplicate` → "Plan B – south zone" created with same content.
2. Drag the zone circle south, redraw arrow.
3. Team switches between tabs; presence dots on each tab show who's where.

## UF-8 Follow the captain
1. IGL → presence avatar menu (own) → `Summon everyone`.
2. All members get toast "IGL is presenting — following" and their map follows IGL's view (board + pan + zoom).
3. Any member pans manually or clicks `Stop following` → leaves follow mode.
4. IGL uses **Laser** (K) to point while explaining on Discord voice.

## UF-9 Study a map alone (casual learner)
1. **[Landing]** `Explore maps` → read-only demo board (no account).
2. Switch map with board dropdown, toggle labels/grid, use **Measure** from Georgopol to Pochinki → "3 420 m · ~9 min on foot · ~2.5 min by vehicle (approx.)".
3. CTA "Create a free account to save your own boards".

## UF-10 Manage members (owner)
1. **[Room]** right panel → Members.
2. Change Rudra's role Editor → Viewer → Rudra's toolbar updates instantly, toast "Your role changed to Viewer".
3. Kick a user → confirm → user sees modal "You were removed from this room" and is sent to dashboard; system chat message posted.

## UF-11 Restore a snapshot
1. Board kebab → `Snapshots` → drawer.
2. Hover "Plan A – north zone" → preview; `Restore` → confirm dialog ("current state will be saved as an auto-snapshot").
3. Board resets for everyone; system message "Shiva restored snapshot 'Plan A – north zone'".

## UF-12 Export a plan
1. Fit map to the area → `⋯ → Export PNG`.
2. Options: include grid ✓, include labels layer ✓, hide cursors (always) → download `team-soul_erangel-plan-a_2026-10-25.png`.

## UF-13 Network drop & recovery
1. User's Wi-Fi drops mid-drawing → indicator "▲ Reconnecting…", drawing continues locally (ops queued, max 500).
2. Network returns → auto-reconnect → `board:subscribe {sinceSeq}` → delta applied → queued ops re-sent → "● Synced".
3. If offline > 10 min or queue full → banner "You're offline. Changes will sync when you reconnect" and further edits blocked after 500 queued ops.

## UF-14 Account settings & deletion
1. Avatar → Settings → change IGN, avatar color → saved.
2. Change password → other devices logged out.
3. Danger → Delete account → enter password + type DELETE → if user owns rooms: dialog to transfer each to a member or delete them → account deleted → **[Landing]**.

## UF-15 Room deletion
1. Owner → Room settings → Danger zone → `Delete room` → type room name.
2. All connected members see modal "This room was deleted by the owner"; room disappears from dashboards. Restorable by owner for 7 days (P1: "Recently deleted" section).
