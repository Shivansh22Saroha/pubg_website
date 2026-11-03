-- Phase 11: public read-only share links (DATABASE_SCHEMA §3.14)
CREATE TABLE "share_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_by" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- one link per board; tokens are looked up by hash
CREATE UNIQUE INDEX "share_links_board_id_key" ON "share_links"("board_id");
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");
CREATE INDEX "share_links_expires_at_idx" ON "share_links"("expires_at");

-- a SHA-256 hex digest, never the raw token
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_token_hash_hex"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "share_links" ADD CONSTRAINT "share_links_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
