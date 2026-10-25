# RotationLab — BGMI / PUBG Tactical Map Sandbox

> Working name. Rename freely; search-and-replace `RotationLab` / `rotationlab` across the docs.

RotationLab is a real-time, multiplayer tactical whiteboard built on top of the official PUBG PC map art for **Erangel**, **Miramar** and **Rondo**. Teams create a private room, invite their squad, and plan drops, rotations, zone scenarios and enemy positions together — drawing on a zoomable map while chatting in the same screen.

Think "Excalidraw on a PUBG map, for a 4-man squad and their coach."

---

## 1. What it does (v1)

| Area | Capability |
|---|---|
| Accounts | Email + password sign-up/login, profile (username, IGN, avatar color) |
| Rooms | Create private rooms, invite by link/code (optional room password), roles: Owner / Editor / Viewer |
| Maps | Erangel, Miramar, Rondo — deep-zoom tiled maps, labels ON/OFF toggle (uses the `Main` vs `Main_No_Text` art), A–H / I–P grid overlay |
| Drawing | Freehand pen, line, arrow (rotation path), circle (zone), polygon (area), text label, eraser, select/move, undo/redo |
| Markers | Own squad / own players (P1–P4), enemy squads (numbered + color), vehicle, drop point, danger, hold/compound |
| Boards | Multiple boards (scenarios) per room, each bound to one map; layers inside each board; snapshots |
| Collaboration | Live sync of every edit, live cursors with names, laser pointer, "follow captain" view mode |
| Chat | Room chat with **map pings** (a message can carry a map location; clicking it flies the map there) |
| Study tools | Distance measure (metres + estimated travel time), grid, labels toggle |
| Export | Export current board view as PNG |

Full scope: see [`docs/PRD.md`](docs/PRD.md) and [`docs/FEATURES.md`](docs/FEATURES.md).

---

## 2. Tech stack (summary)

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui |
| Map engine | Leaflet + react-leaflet with `CRS.Simple` and self-hosted XYZ tiles |
| Client state | Zustand (board/UI state), TanStack Query (REST data) |
| Realtime | Socket.IO (client + server) with Redis adapter |
| Backend | Node.js + Fastify + TypeScript |
| Validation | Zod schemas shared between client and server (`packages/shared`) |
| Database | PostgreSQL + Prisma ORM |
| Cache / presence / rate limits | Redis |
| Auth | argon2id password hashing, short-lived JWT access token + rotating refresh token, both in httpOnly cookies |
| Tiles | One-time `sharp` script that slices the high-res PNGs into WebP XYZ tiles, served from object storage / CDN |
| Tests | Vitest, Testing Library, Supertest, Playwright |
| Deploy | Docker Compose (dev + single-VM prod), GitHub Actions CI |

Exact versions and reasons: [`docs/TECH_STACK.md`](docs/TECH_STACK.md).

---

## 3. Repository layout

```
rotationlab/
├─ apps/
│  ├─ web/                 # Next.js frontend
│  └─ server/              # Fastify REST API + Socket.IO realtime server
├─ packages/
│  ├─ shared/              # Zod schemas, TS types, map config, socket event contracts
│  └─ map-tiles/           # Tile generation script (sharp)
├─ docs/                   # All spec documents (this pack)
├─ docker/                 # Dockerfiles, nginx/Caddy config
├─ docker-compose.yml
├─ turbo.json
├─ pnpm-workspace.yaml
└─ README.md
```

---

## 4. Getting started (local)

### Prerequisites
- Node.js 22 LTS (or newer LTS)
- pnpm (via `corepack enable`)
- Docker + Docker Compose (for Postgres and Redis)
- `git-lfs` (only needed once, to download the high-res map art)
- ~3 GB free disk for raw map images + generated tiles

### Steps

```bash
# 1. Install
git clone <your-repo-url> rotationlab && cd rotationlab
corepack enable
pnpm install

# 2. Environment
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
# fill in secrets — see docs/ENVIRONMENT.md

# 3. Infra
docker compose up -d postgres redis
# port 5432/6379 already in use? put POSTGRES_PORT=5434 (and/or REDIS_PORT=…) in a root .env
# and change DATABASE_URL / REDIS_URL in apps/server/.env to match

# 4. Database
pnpm --filter server prisma migrate dev
pnpm --filter server prisma db seed

# 5. Map tiles (one-time, ~5–15 min)
pnpm --filter map-tiles run fetch      # downloads the 6 high-res PNGs via Git LFS (`fetch` alone is a pnpm built-in)
pnpm --filter map-tiles run build      # writes WebP tiles to packages/map-tiles/out/ (~25 s)
pnpm --filter map-tiles run copy-dev   # copies them to apps/web/public/tiles (gitignored)
# then open http://localhost:3000/maps/erangel

# 6. Run everything
pnpm dev
# web:    http://localhost:3000
# server: http://localhost:4000  (REST under /api/v1, Socket.IO under /realtime)
```

---

## 5. Map assets

Source: `https://github.com/pubg/api-assets/tree/master/Assets/Maps`

Only these files are used:

| Map | Internal telemetry name | Labelled art | Unlabelled art |
|---|---|---|---|
| Erangel | `Erangel_Main` / `Baltic_Main` (remastered) | `Erangel_Main_High_Res.png` (~95 MB) | `Erangel_Main_No_Text_High_Res.png` (~95 MB) |
| Miramar | `Desert_Main` | `Miramar_Main_High_Res.png` (~112 MB) | `Miramar_Main_No_Text_High_Res.png` (~112 MB) |
| Rondo | `Neon_Main` | `Rondo_Main_High_Res.png` (~118 MB) | `Rondo_Main_No_Text_High_Res.png` (~122 MB) |

Facts verified in the repo (Oct 2026):
- All `*_High_Res.png` files are stored in **Git LFS** — a normal clone gives 133-byte pointer files. Use `git lfs pull --include="Assets/Maps/{Erangel,Miramar,Rondo}_Main*_High_Res.png"` or the `media.githubusercontent.com` raw URLs.
- The `*_Low_Res.png` files are 819×819 and are fine for thumbnails/placeholders.
- ⚠️ `Rondo_Main_Low_Res.png` is actually a **JPEG with a .png extension**. Detect by file signature, not extension.
- The repo also contains vehicle and item icons (`Assets/Vehicle`, `Assets/Item`, `Assets/Icons`) that can be used for markers later.

### Licensing ⚠️
The PUBG repo states assets must be used under the **PUBG Developer Terms of Use** (developer.pubg.com/tos) and the **PUBG Player-created Content** policy. Before any public launch:
- Read both documents and confirm your use (non-commercial fan tool) is allowed.
- Show a footer attribution: "PUBG map imagery © KRAFTON, Inc. RotationLab is a fan project, not affiliated with or endorsed by KRAFTON."
- Note: these are **PC** map renders. BGMI's versions of these maps are close but not identical — say so in the UI.

---

## 6. Common commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs web + server in watch mode |
| `pnpm build` | Production build of all apps |
| `pnpm test` | Unit + integration tests |
| `pnpm test:e2e` | Playwright E2E (uses committed fixture tiles; locally reuses `pnpm dev` on :3000) |
| `pnpm lint` / `pnpm typecheck` | ESLint / tsc across the monorepo |
| `pnpm --filter server prisma studio` | DB browser |

---

## 7. Document index

| Doc | Purpose |
|---|---|
| [PRD.md](docs/PRD.md) | Product requirements |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, realtime sync model |
| [UI_UX_SPEC.md](docs/UI_UX_SPEC.md) | Screens, layout, colors, components, responsive rules |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Tables, relations, indexes, Prisma schema |
| [API_SPEC.md](docs/API_SPEC.md) | REST endpoints + Socket.IO events |
| [SECURITY.md](docs/SECURITY.md) | Auth, authorization, validation, threat model |
| [TECH_STACK.md](docs/TECH_STACK.md) | Libraries, versions, reasons |
| [USER_FLOWS.md](docs/USER_FLOWS.md) | Step-by-step journeys |
| [FEATURES.md](docs/FEATURES.md) | Feature-by-feature behavior |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Env variables, services |
| [TESTING.md](docs/TESTING.md) | Test strategy and required cases |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, CI/CD, production |
| [CHANGELOG.md](docs/CHANGELOG.md) | History |
| [TODO.md](docs/TODO.md) | Build phases, backlog |

---

## 8. Instructions for the coding AI

1. Read `PRD.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_SPEC.md`, `SECURITY.md` before writing code.
2. Build in the phase order in `TODO.md`. Finish and test one phase before starting the next.
3. All request/response and socket payloads **must** be validated with the Zod schemas in `packages/shared` — never hand-roll a second copy of a type.
4. All coordinates are stored in **world units (centimetres, 0–816000)**, never in pixels or Leaflet lat/lng. See ARCHITECTURE §5.
5. Update `CHANGELOG.md` and tick `TODO.md` at the end of each phase.
