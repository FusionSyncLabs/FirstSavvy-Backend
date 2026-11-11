/*
  Warnings:

  - You are about to alter the column `code` on the `referrals` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - You are about to alter the column `short_id` on the `referrals` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - The `status` column on the `referrals` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `description` on the `referrals` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - You are about to alter the column `referral_code` on the `users` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.

*/
-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "referrals" ALTER COLUMN "code" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "short_id" SET DATA TYPE VARCHAR(20),
DROP COLUMN "status",
ADD COLUMN     "status" "ReferralStatus" NOT NULL DEFAULT 'active',
ALTER COLUMN "description" SET DATA TYPE VARCHAR(500);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "referral_code" SET DATA TYPE VARCHAR(50);

-- CreateIndex
CREATE INDEX "referrals_status_expires_at_idx" ON "referrals"("status", "expires_at");
