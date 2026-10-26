-- CreateEnum
CREATE TYPE "ChatKind" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "author_id" UUID,
    "kind" "ChatKind" NOT NULL DEFAULT 'USER',
    "body" VARCHAR(500) NOT NULL,
    "ping_board_id" UUID,
    "ping_x" INTEGER,
    "ping_y" INTEGER,
    "client_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_room_id_id_idx" ON "chat_messages"("room_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_author_id_client_id_key" ON "chat_messages"("author_id", "client_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ping_board_id_fkey" FOREIGN KEY ("ping_board_id") REFERENCES "boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Raw SQL Prisma can't express (DATABASE_SCHEMA §3.12, SECURITY V3)
ALTER TABLE "chat_messages" ALTER COLUMN "id" SET DEFAULT gen_random_uuid(); -- app code sends UUIDv7
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_length" CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ping_x" CHECK ("ping_x" IS NULL OR "ping_x" BETWEEN 0 AND 1000000);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ping_y" CHECK ("ping_y" IS NULL OR "ping_y" BETWEEN 0 AND 1000000);
-- ping fields: all null, or x/y set (the board may later be nulled by ON DELETE SET NULL)
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ping_all_or_none" CHECK (
  ("ping_x" IS NULL AND "ping_y" IS NULL AND "ping_board_id" IS NULL)
  OR ("ping_x" IS NOT NULL AND "ping_y" IS NOT NULL)
);
-- system messages have no author and no client id; user messages always have a client id
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_system_shape" CHECK (
  "kind" = 'USER' OR ("author_id" IS NULL AND "client_id" IS NULL)
);
