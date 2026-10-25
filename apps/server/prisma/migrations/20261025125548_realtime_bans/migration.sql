-- CreateEnum
CREATE TYPE "ElementType" AS ENUM ('STROKE', 'LINE', 'ARROW', 'CIRCLE', 'POLYGON', 'TEXT', 'MARKER');

-- CreateTable
CREATE TABLE "room_bans" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "banned_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_bans_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "elements" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "type" "ElementType" NOT NULL,
    "geometry" JSONB NOT NULL,
    "style" JSONB NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "z" INTEGER NOT NULL DEFAULT 0,
    "seq" BIGINT NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_ops" (
    "board_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "op_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" VARCHAR(24) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_ops_pkey" PRIMARY KEY ("board_id","seq")
);

-- CreateIndex
CREATE INDEX "elements_board_id_idx" ON "elements"("board_id");

-- CreateIndex
CREATE INDEX "elements_layer_id_idx" ON "elements"("layer_id");

-- CreateIndex
CREATE INDEX "board_ops_created_at_idx" ON "board_ops"("created_at");

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_banned_by_fkey" FOREIGN KEY ("banned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_ops" ADD CONSTRAINT "board_ops_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
