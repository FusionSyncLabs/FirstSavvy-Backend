/*
  Warnings:

  - The `permission_level` column on the `profile_shares` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ProfileSharePermission" AS ENUM ('view_only', 'editor', 'co_parent');

-- AlterTable
ALTER TABLE "plaid_accounts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "plaid_items" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "profile_shares" DROP COLUMN "permission_level",
ADD COLUMN     "permission_level" "ProfileSharePermission" NOT NULL DEFAULT 'view_only';

-- CreateTable
CREATE TABLE "Events" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "destination" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "for" TEXT[],
    "is_trip" INTEGER NOT NULL,
    "star_earning" INTEGER NOT NULL,
    "color_code" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_verifications_profile_id_idx" ON "credit_verifications"("profile_id");

-- CreateIndex
CREATE INDEX "financial_goals_profile_id_target_date_idx" ON "financial_goals"("profile_id", "target_date");

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
