-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referred_by_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "short_id" TEXT NOT NULL,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" DATE,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- CREATE UNIQUE INDEX "referrals_code_key" ON "referrals"("code");

-- CreateIndex
-- CREATE UNIQUE INDEX "referrals_short_id_key" ON "referrals"("short_id");

-- AddForeignKey
-- ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
