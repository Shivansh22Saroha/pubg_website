-- Sign in with Google (FEATURES F17): the Google account's stable subject id, linked once.
ALTER TABLE "users" ADD COLUMN "google_sub" TEXT;
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");
