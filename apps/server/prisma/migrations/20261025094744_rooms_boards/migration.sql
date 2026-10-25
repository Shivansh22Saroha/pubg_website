-- CreateEnum
CREATE TYPE "RoomRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MapId" AS ENUM ('ERANGEL', 'MIRAMAR', 'RONDO');

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(280),
    "owner_id" UUID NOT NULL,
    "password_hash" TEXT,
    "default_role" "RoomRole" NOT NULL DEFAULT 'EDITOR',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "max_members" SMALLINT NOT NULL DEFAULT 16,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoomRole" NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "room_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "code" CHAR(10) NOT NULL,
    "created_by" UUID,
    "role" "RoomRole" NOT NULL,
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "map_id" "MapId" NOT NULL,
    "position" INTEGER NOT NULL,
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "element_count" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "color" CHAR(7) NOT NULL,
    "position" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_owner_id_idx" ON "rooms"("owner_id");

-- CreateIndex
CREATE INDEX "room_members_user_id_idx" ON "room_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_invites_code_key" ON "room_invites"("code");

-- CreateIndex
CREATE INDEX "room_invites_room_id_idx" ON "room_invites"("room_id");

-- CreateIndex
CREATE INDEX "boards_room_id_position_idx" ON "boards"("room_id", "position");

-- CreateIndex
CREATE INDEX "layers_board_id_position_idx" ON "layers"("board_id", "position");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL (DATABASE_SCHEMA §3.4–3.8) — keep when regenerating.
-- Exactly one OWNER per room (rooms.owner_id is kept in sync by the service transaction).
CREATE UNIQUE INDEX "room_members_one_owner" ON "room_members"("room_id") WHERE "role" = 'OWNER';
-- Soft-deleted rooms are scanned by the purge job.
CREATE INDEX "rooms_deleted_at_idx" ON "rooms"("deleted_at") WHERE "deleted_at" IS NOT NULL;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_name_length" CHECK (char_length("name") >= 3);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_default_role_not_owner" CHECK ("default_role" <> 'OWNER');
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_max_members_range" CHECK ("max_members" BETWEEN 2 AND 50);
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_role_not_owner" CHECK ("role" <> 'OWNER');
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_max_uses_positive" CHECK ("max_uses" IS NULL OR "max_uses" > 0);
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_use_count_range" CHECK ("use_count" >= 0 AND ("max_uses" IS NULL OR "use_count" <= "max_uses"));
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_code_format" CHECK ("code" ~ '^[0-9A-HJKMNP-TV-Z]{10}$');
ALTER TABLE "boards" ADD CONSTRAINT "boards_element_count_range" CHECK ("element_count" BETWEEN 0 AND 5000);
ALTER TABLE "boards" ADD CONSTRAINT "boards_name_length" CHECK (char_length("name") >= 1);
ALTER TABLE "layers" ADD CONSTRAINT "layers_color_hex" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "layers" ADD CONSTRAINT "layers_name_length" CHECK (char_length("name") >= 1);
