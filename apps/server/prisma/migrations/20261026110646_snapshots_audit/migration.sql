-- CreateTable
CREATE TABLE "snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "element_count" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "room_id" UUID,
    "action" VARCHAR(48) NOT NULL,
    "target_id" UUID,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snapshots_board_id_created_at_idx" ON "snapshots"("board_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_room_id_created_at_idx" ON "audit_logs"("room_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Raw SQL Prisma can't express (DATABASE_SCHEMA §3.11 / §3.13)
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_element_count" CHECK ("element_count" BETWEEN 0 AND 5000);
-- the app caps data at 5 MB; this is the backstop
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_data_size" CHECK (pg_column_size("data") <= 5242880);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action" CHECK ("action" ~ '^[a-z_]+\.[a-z_]+$');
-- audit rows outlive users and rooms on purpose: no foreign keys (actor_id / room_id may dangle)
