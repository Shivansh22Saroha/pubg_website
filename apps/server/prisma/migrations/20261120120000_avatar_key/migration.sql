-- Profile photos (FEATURES F23): the stored photo's asset key; null shows initials.
ALTER TABLE "users" ADD COLUMN "avatar_key" TEXT;
