-- Phase 9: per-user UI preferences (the room coach-mark tour), shared across devices
ALTER TABLE "users" ADD COLUMN "prefs" JSONB NOT NULL DEFAULT '{}';

-- an object of at most 4 KB; the app validates its keys (UserPrefsSchema)
ALTER TABLE "users" ADD CONSTRAINT "users_prefs_object"
  CHECK (jsonb_typeof("prefs") = 'object' AND octet_length("prefs"::text) <= 4096);
