-- Raw SQL for the realtime tables (DATABASE_SCHEMA §3.9–3.10, §4) — Prisma can't express these.
ALTER TABLE "elements" ADD CONSTRAINT "elements_geometry_size" CHECK (pg_column_size("geometry") < 65536);
ALTER TABLE "elements" ADD CONSTRAINT "elements_style_size" CHECK (pg_column_size("style") < 8192);
ALTER TABLE "elements" ADD CONSTRAINT "elements_props_size" CHECK (pg_column_size("props") < 8192);
ALTER TABLE "elements" ADD CONSTRAINT "elements_seq_nonneg" CHECK ("seq" >= 0);
ALTER TABLE "board_ops" ADD CONSTRAINT "board_ops_seq_positive" CHECK ("seq" > 0);
ALTER TABLE "board_ops" ADD CONSTRAINT "board_ops_kind" CHECK ("kind" IN (
  'element:upsert', 'element:delete', 'layer:upsert', 'layer:delete', 'layer:reorder', 'layer:clear'
));
ALTER TABLE "boards" ADD CONSTRAINT "boards_last_seq_nonneg" CHECK ("last_seq" >= 0);
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_not_self" CHECK ("banned_by" IS NULL OR "banned_by" <> "user_id");
