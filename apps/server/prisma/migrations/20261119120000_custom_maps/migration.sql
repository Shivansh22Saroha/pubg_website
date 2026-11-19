-- Custom maps (FEATURES F20): images a room uploads to plan on.
ALTER TYPE "MapId" ADD VALUE 'CUSTOM';

CREATE TABLE "custom_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "width_m" INTEGER NOT NULL,
    "image_key" TEXT NOT NULL,
    "preview_key" TEXT NOT NULL,
    "size_px" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_maps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_maps_width_m_check" CHECK ("width_m" BETWEEN 50 AND 50000),
    CONSTRAINT "custom_maps_size_px_check" CHECK ("size_px" BETWEEN 256 AND 4096),
    CONSTRAINT "custom_maps_name_check" CHECK (char_length("name") BETWEEN 1 AND 40)
);
CREATE INDEX "custom_maps_room_id_created_at_idx" ON "custom_maps"("room_id", "created_at");
ALTER TABLE "custom_maps" ADD CONSTRAINT "custom_maps_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_maps" ADD CONSTRAINT "custom_maps_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "boards" ADD COLUMN "custom_map_id" UUID;
CREATE INDEX "boards_custom_map_id_idx" ON "boards"("custom_map_id");
-- a custom map can't be deleted while a board uses it (the API answers 409 first); NO ACTION
-- (checked at the end of the statement) so deleting the whole room cascades cleanly
ALTER TABLE "boards" ADD CONSTRAINT "boards_custom_map_id_fkey"
    FOREIGN KEY ("custom_map_id") REFERENCES "custom_maps"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- custom boards name their map; PUBG boards don't. (Compared as text: a new enum value
-- can't be referenced as a literal in the transaction that adds it.)
ALTER TABLE "boards" ADD CONSTRAINT "boards_custom_map_check"
    CHECK (("map_id"::text = 'CUSTOM') = ("custom_map_id" IS NOT NULL));
