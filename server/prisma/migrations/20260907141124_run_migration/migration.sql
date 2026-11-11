-- =========================================================================
-- 2FA CHANGES & VERIFICATIONS TABLE
-- =========================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN "two_factor_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "two_factor_method" VARCHAR(50),
ADD COLUMN "two_factor_secret" VARCHAR(255);

-- CreateTable
CREATE TABLE "two_factor_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" VARCHAR(50) NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_verifications_user_id_idx" ON "two_factor_verifications"("user_id");

-- CreateIndex
CREATE INDEX "two_factor_verifications_code_idx" ON "two_factor_verifications"("code");

-- CreateIndex
CREATE INDEX "two_factor_verifications_expires_at_idx" ON "two_factor_verifications"("expires_at");

-- CreateIndex
CREATE INDEX "users_two_factor_enabled_idx" ON "users"("two_factor_enabled");

-- AddForeignKey
ALTER TABLE "two_factor_verifications" ADD CONSTRAINT "two_factor_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;