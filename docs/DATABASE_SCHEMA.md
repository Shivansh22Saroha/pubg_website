# DATABASE SCHEMA — RotationLab

PostgreSQL (16+) via Prisma. Naming: tables `snake_case` plural, columns `snake_case`, Prisma models `PascalCase` with `@@map`/`@map`.
All primary keys are **UUID** (UUIDv7 generated in app code for time-ordering; `gen_random_uuid()` as DB default fallback). All timestamps `timestamptz`, UTC.

## 1. ER overview

```
users 1──* refresh_tokens
users 1──* room_members *──1 rooms
rooms 1──* room_invites
rooms 1──* room_bans *──1 users
rooms 1──* boards 1──* layers 1──* elements
                  boards 1──* board_ops
                  boards 1──* snapshots
rooms 1──* chat_messages *──1 users (author, nullable after deletion)
users / rooms 1──* audit_logs
```

## 2. Enums
| Enum | Values |
|---|---|
| `room_role` | `OWNER`, `EDITOR`, `VIEWER` |
| `map_id` | `ERANGEL`, `MIRAMAR`, `RONDO` |
| `element_type` | `STROKE`, `LINE`, `ARROW`, `CIRCLE`, `POLYGON`, `TEXT`, `MARKER` |
| `chat_kind` | `USER`, `SYSTEM` |

## 3. Tables

### 3.1 `users`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | citext | NOT NULL, UNIQUE |
| username | citext | NOT NULL, UNIQUE, CHECK `username ~ '^[a-z0-9_]{3,20}$'` |
| display_name | varchar(32) | NOT NULL |
| ign | varchar(32) | NULL (in-game name) |
| avatar_color | char(7) | NOT NULL default `'#38BDF8'`, CHECK hex |
| password_hash | text | NOT NULL (argon2id encoded string) |
| email_verified_at | timestamptz | NULL |
| failed_login_count | int | NOT NULL default 0 |
| locked_until | timestamptz | NULL |
| created_at / updated_at | timestamptz | NOT NULL |
| deleted_at | timestamptz | NULL (soft delete; PII scrubbed by job) |

### 3.2 `refresh_tokens`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users ON DELETE CASCADE |
| token_hash | char(64) | NOT NULL UNIQUE (SHA-256 of opaque token) |
| family_id | uuid | NOT NULL (rotation family for reuse detection) |
| replaced_by | uuid | NULL FK → refresh_tokens |
| user_agent | varchar(256) | NULL |
| ip_hash | char(64) | NULL (salted hash, not raw IP) |
| expires_at | timestamptz | NOT NULL |
| revoked_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL |
Index: `(user_id)`, `(family_id)`.

### 3.3 `email_tokens` (verification + password reset, P1)
| id uuid PK | user_id FK CASCADE | purpose varchar(16) CHECK in ('verify','reset') | token_hash char(64) UNIQUE | expires_at | used_at NULL | created_at |

### 3.4 `rooms`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar(40) | NOT NULL, CHECK length ≥ 3 |
| description | varchar(280) | NULL |
| owner_id | uuid | FK → users ON DELETE RESTRICT |
| password_hash | text | NULL (argon2id) |
| default_role | room_role | NOT NULL default `EDITOR`, CHECK ≠ OWNER |
| is_locked | boolean | NOT NULL default false |
| max_members | smallint | NOT NULL default 16, CHECK 2–50 |
| last_activity_at | timestamptz | NOT NULL |
| created_at / updated_at | timestamptz | NOT NULL |
| deleted_at | timestamptz | NULL |
Index: `(owner_id)`, partial `(deleted_at) WHERE deleted_at IS NOT NULL`.

### 3.5 `room_members`
| Column | Type | Constraints |
|---|---|---|
| room_id | uuid | FK → rooms ON DELETE CASCADE |
| user_id | uuid | FK → users ON DELETE CASCADE |
| role | room_role | NOT NULL |
| joined_at | timestamptz | NOT NULL |
| last_seen_at | timestamptz | NULL |
PK `(room_id, user_id)`. Index `(user_id)`.
Constraint: exactly one OWNER per room — partial unique index `UNIQUE (room_id) WHERE role = 'OWNER'`; and `rooms.owner_id` must match (kept in sync in the service transaction).

### 3.6 `room_invites`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| room_id | uuid | FK → rooms CASCADE |
| code | char(10) | NOT NULL UNIQUE (Crockford base32, ~50 bits) |
| created_by | uuid | FK → users SET NULL |
| role | room_role | NOT NULL, CHECK ≠ OWNER |
| max_uses | int | NULL (unlimited) CHECK > 0 |
| use_count | int | NOT NULL default 0 |
| expires_at | timestamptz | NULL |
| revoked_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL |
Index `(room_id)`.

### 3.6b `room_bans` (kick + block)
| Column | Type | Constraints |
|---|---|---|
| room_id | uuid | FK → rooms CASCADE |
| user_id | uuid | FK → users CASCADE |
| banned_by | uuid | NULL FK → users SET NULL, CHECK ≠ user_id |
| created_at | timestamptz | NOT NULL |
PK `(room_id, user_id)`. Written by `DELETE /rooms/:roomId/members/:userId { ban: true }`; checked by invite accept.

### 3.7 `boards`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| room_id | uuid | FK → rooms CASCADE |
| name | varchar(40) | NOT NULL |
| map_id | map_id | NOT NULL |
| position | int | NOT NULL (tab order) |
| last_seq | bigint | NOT NULL default 0 |
| element_count | int | NOT NULL default 0, CHECK ≤ 5000 |
| thumbnail_key | text | NULL (object storage key) |
| created_by | uuid | FK → users SET NULL |
| created_at / updated_at | timestamptz | NOT NULL |
Index `(room_id, position)`. App-level limit 20 boards per room.

### 3.8 `layers`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK (client-generated UUIDv7) |
| board_id | uuid | FK → boards CASCADE |
| name | varchar(32) | NOT NULL |
| color | char(7) | NOT NULL |
| position | int | NOT NULL |
| visible | boolean | NOT NULL default true (board-wide default; users also have local hide) |
| locked | boolean | NOT NULL default false |
| seq | bigint | NOT NULL |
| created_at / updated_at | timestamptz | NOT NULL |
Index `(board_id, position)`. App-level limit 10 per board, min 1.

### 3.9 `elements`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK (client-generated UUIDv7) |
| board_id | uuid | FK → boards CASCADE |
| layer_id | uuid | FK → layers CASCADE |
| type | element_type | NOT NULL |
| geometry | jsonb | NOT NULL — shape per type, see §4 |
| style | jsonb | NOT NULL — `{color, width, dashed, fillOpacity}` |
| props | jsonb | NOT NULL default `'{}'` — marker kind, label, text, team number |
| z | int | NOT NULL default 0 |
| seq | bigint | NOT NULL — board seq of last write |
| created_by | uuid | FK → users SET NULL |
| updated_by | uuid | FK → users SET NULL |
| created_at / updated_at | timestamptz | NOT NULL |
Indexes: `(board_id)`, `(layer_id)`. CHECK `pg_column_size(geometry) < 65536`.
Deletes are hard deletes (op log + snapshots provide history).

### 3.10 `board_ops` (short-lived replay log)
| Column | Type | Constraints |
|---|---|---|
| board_id | uuid | FK → boards CASCADE |
| seq | bigint | NOT NULL |
| op_id | uuid | NOT NULL (client op id) |
| actor_id | uuid | NULL FK → users SET NULL |
| kind | varchar(24) | NOT NULL (`element:upsert`, …) |
| payload | jsonb | NOT NULL |
| created_at | timestamptz | NOT NULL |
PK `(board_id, seq)`. Index `(created_at)` for pruning. Retention: 24 h / last 1 000 per board.

### 3.11 `snapshots`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| board_id | uuid | FK → boards CASCADE |
| name | varchar(60) | NOT NULL |
| is_auto | boolean | NOT NULL default false |
| data | jsonb | NOT NULL — `{ version: 1, layers: [...], elements: [...] }` (gzip-friendly; ≤ 5 MB enforced in app) |
| element_count | int | NOT NULL |
| created_by | uuid | FK → users SET NULL |
| created_at | timestamptz | NOT NULL |
Index `(board_id, created_at DESC)`. Limit 50 manual + 10 auto per board (oldest auto pruned).

### 3.12 `chat_messages`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK (UUIDv7 → sortable cursor) |
| room_id | uuid | FK → rooms CASCADE |
| author_id | uuid | NULL FK → users SET NULL |
| kind | chat_kind | NOT NULL default USER |
| body | varchar(500) | NOT NULL |
| ping_board_id | uuid | NULL FK → boards SET NULL |
| ping_x | int | NULL CHECK 0–1 000 000 |
| ping_y | int | NULL CHECK 0–1 000 000 |
| deleted_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL |
Index `(room_id, id DESC)`. CHECK ping fields all null or all set (board may later be nulled).

### 3.13 `audit_logs`
| id uuid PK | actor_id uuid NULL | room_id uuid NULL | action varchar(48) (e.g. `room.kick`, `role.change`, `auth.login_failed`, `snapshot.restore`) | target_id uuid NULL | meta jsonb | ip_hash char(64) NULL | created_at |
Index `(room_id, created_at DESC)`, `(actor_id, created_at DESC)`. Retention 90 days.

## 4. JSON shapes (validated by Zod in `packages/shared`, world units = cm)
```ts
type Pt = [x: number, y: number];          // integers 0..worldSize
STROKE  geometry: { points: Pt[] }          // 2..2000 points, pre-simplified on client
LINE    geometry: { points: [Pt, Pt] }
ARROW   geometry: { points: Pt[] }          // 2..50 points (bends)
CIRCLE  geometry: { center: Pt, r: number } // r 100..600000
POLYGON geometry: { points: Pt[] }          // 3..200
TEXT    geometry: { at: Pt }   props: { text: string(1..120), size: 'sm'|'md'|'lg' }
MARKER  geometry: { at: Pt }   props: { kind: 'own_squad'|'own_player'|'enemy_squad'|'vehicle'|'drop'|'danger'|'hold'|'pin',
                                         number?: 1..25, label?: string(0..24) }
style: { color: '#RRGGBB', width: 2|4|7, dashed: boolean, fillOpacity: 0..0.6 }
```

## 5. Prisma schema (abridged — implement fully)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL"); extensions = [citext] }

enum RoomRole    { OWNER EDITOR VIEWER }
enum MapId       { ERANGEL MIRAMAR RONDO }
enum ElementType { STROKE LINE ARROW CIRCLE POLYGON TEXT MARKER }
enum ChatKind    { USER SYSTEM }

model User {
  id               String    @id @db.Uuid
  email            String    @unique @db.Citext
  username         String    @unique @db.Citext
  displayName      String    @map("display_name") @db.VarChar(32)
  ign              String?   @db.VarChar(32)
  avatarColor      String    @default("#38BDF8") @map("avatar_color") @db.Char(7)
  passwordHash     String    @map("password_hash")
  emailVerifiedAt  DateTime? @map("email_verified_at") @db.Timestamptz
  failedLoginCount Int       @default(0) @map("failed_login_count")
  lockedUntil      DateTime? @map("locked_until") @db.Timestamptz
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt        DateTime? @map("deleted_at") @db.Timestamptz
  memberships      RoomMember[]
  refreshTokens    RefreshToken[]
  ownedRooms       Room[]    @relation("RoomOwner")
  @@map("users")
}

model Room {
  id             String    @id @db.Uuid
  name           String    @db.VarChar(40)
  description    String?   @db.VarChar(280)
  ownerId        String    @map("owner_id") @db.Uuid
  owner          User      @relation("RoomOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  passwordHash   String?   @map("password_hash")
  defaultRole    RoomRole  @default(EDITOR) @map("default_role")
  isLocked       Boolean   @default(false) @map("is_locked")
  maxMembers     Int       @default(16) @map("max_members") @db.SmallInt
  lastActivityAt DateTime  @default(now()) @map("last_activity_at") @db.Timestamptz
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt      DateTime? @map("deleted_at") @db.Timestamptz
  members        RoomMember[]
  invites        RoomInvite[]
  boards         Board[]
  messages       ChatMessage[]
  @@index([ownerId])
  @@map("rooms")
}

model RoomMember {
  roomId     String    @map("room_id") @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  role       RoomRole
  joinedAt   DateTime  @default(now()) @map("joined_at") @db.Timestamptz
  lastSeenAt DateTime? @map("last_seen_at") @db.Timestamptz
  room       Room      @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([roomId, userId])
  @@index([userId])
  @@map("room_members")
}

model Board {
  id           String   @id @db.Uuid
  roomId       String   @map("room_id") @db.Uuid
  name         String   @db.VarChar(40)
  mapId        MapId    @map("map_id")
  position     Int
  lastSeq      BigInt   @default(0) @map("last_seq")
  elementCount Int      @default(0) @map("element_count")
  thumbnailKey String?  @map("thumbnail_key")
  createdBy    String?  @map("created_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  room         Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  layers       Layer[]
  elements     Element[]
  snapshots    Snapshot[]
  @@index([roomId, position])
  @@map("boards")
}

model Element {
  id        String      @id @db.Uuid
  boardId   String      @map("board_id") @db.Uuid
  layerId   String      @map("layer_id") @db.Uuid
  type      ElementType
  geometry  Json
  style     Json
  props     Json        @default("{}")
  z         Int         @default(0)
  seq       BigInt
  createdBy String?     @map("created_by") @db.Uuid
  updatedBy String?     @map("updated_by") @db.Uuid
  createdAt DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime    @updatedAt @map("updated_at") @db.Timestamptz
  board     Board       @relation(fields: [boardId], references: [id], onDelete: Cascade)
  layer     Layer       @relation(fields: [layerId], references: [id], onDelete: Cascade)
  @@index([boardId])
  @@index([layerId])
  @@map("elements")
}
// Layer, RefreshToken, EmailToken, RoomInvite, BoardOp, Snapshot, ChatMessage, AuditLog:
// implement exactly per §3 tables.
```

Raw-SQL migration additions (Prisma can't express them): `CREATE EXTENSION citext;`, username CHECK, partial unique index for single OWNER, chat ping CHECK, geometry size CHECK, hex color CHECKs.

## 6. Key transactions
| Operation | Transaction contents |
|---|---|
| Create room | insert room → insert member(OWNER) → insert first board → insert default layers ("Plan", "Enemies", "Zones") |
| Element upsert | `UPDATE boards SET last_seq = last_seq+1, element_count = ... RETURNING last_seq` → upsert element with seq → insert board_op |
| Transfer ownership | update old owner member → EDITOR, new → OWNER, rooms.owner_id, audit log |
| Snapshot restore | insert auto snapshot → delete layers (cascade elements) → insert layers/elements from snapshot → bump last_seq → audit |
| Delete account | revoke tokens → for each owned room: transfer to longest-standing Editor or soft-delete → anonymise (email → `deleted+<id>@invalid`, username → `deleted_<short>`), keep chat author null |

## 7. Seed data
- 2 users (`alice` / `bob`, dev-only passwords from env), 1 room "Demo Squad" with both, 3 boards (one per map) with sample rotation arrows, a zone circle and enemy markers.
- Three public **demo boards** (one per map; IDs set in env `DEMO_BOARD_IDS`) used by `/explore` ("Explore maps" on the landing page) in read-only mode.
