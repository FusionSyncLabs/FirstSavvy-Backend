-- AlterTable
ALTER TABLE "users" ADD COLUMN "user_name" VARCHAR(40);

-- Backfill existing rows with unique default usernames based on user UUID
UPDATE "users" SET "user_name" = 'user_' || replace(id::text, '-', '') WHERE "user_name" IS NULL;

-- Enforce NOT NULL constraint
ALTER TABLE "users" ALTER COLUMN "user_name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_user_name_key" ON "users"("user_name");

-- CreateIndex
CREATE INDEX "users_user_name_idx" ON "users"("user_name");

