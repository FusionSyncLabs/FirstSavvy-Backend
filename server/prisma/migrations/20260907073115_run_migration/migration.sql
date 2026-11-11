-- =========================================================================
-- Safe Migration: Add unique_id + secret_keys table
-- =========================================================================

-- 1. Add unique_id as nullable columns first
ALTER TABLE "users"          ADD COLUMN "unique_id" VARCHAR(20);
ALTER TABLE "profiles"       ADD COLUMN "unique_id" VARCHAR(20);
ALTER TABLE "child_profiles" ADD COLUMN "unique_id" VARCHAR(20);

-- 2. Backfill existing rows with unique random strings
UPDATE "users"          SET "unique_id" = SUBSTRING(MD5(RANDOM()::TEXT || "id"::TEXT) FROM 1 FOR 20) WHERE "unique_id" IS NULL;
UPDATE "profiles"       SET "unique_id" = SUBSTRING(MD5(RANDOM()::TEXT || "id"::TEXT) FROM 1 FOR 20) WHERE "unique_id" IS NULL;
UPDATE "child_profiles" SET "unique_id" = SUBSTRING(MD5(RANDOM()::TEXT || "id"::TEXT) FROM 1 FOR 20) WHERE "unique_id" IS NULL;

-- 3. Set NOT NULL constraint and create Indexes
ALTER TABLE "users"          ALTER COLUMN "unique_id" SET NOT NULL;
ALTER TABLE "profiles"       ALTER COLUMN "unique_id" SET NOT NULL;
ALTER TABLE "child_profiles" ALTER COLUMN "unique_id" SET NOT NULL;

CREATE UNIQUE INDEX "users_unique_id_key"          ON "users"("unique_id");
CREATE INDEX        "users_unique_id_idx"          ON "users"("unique_id");

CREATE UNIQUE INDEX "profiles_unique_id_key"       ON "profiles"("unique_id");
CREATE INDEX        "profiles_unique_id_idx"       ON "profiles"("unique_id");

CREATE UNIQUE INDEX "child_profiles_unique_id_key" ON "child_profiles"("unique_id");
CREATE INDEX        "child_profiles_unique_id_idx" ON "child_profiles"("unique_id");

-- =========================================================================
-- Create secret_keys table
-- =========================================================================

CREATE TABLE "secret_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key_value" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "secret_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "secret_keys_key_value_key" ON "secret_keys"("key_value");
CREATE INDEX "secret_keys_user_id_idx"          ON "secret_keys"("user_id");
CREATE INDEX "secret_keys_key_value_idx"         ON "secret_keys"("key_value");
CREATE INDEX "secret_keys_is_active_idx"        ON "secret_keys"("is_active");
CREATE INDEX "secret_keys_deleted_at_idx"       ON "secret_keys"("deleted_at");

-- Add Foreign Key Constraint
ALTER TABLE "secret_keys" ADD CONSTRAINT "secret_keys_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;