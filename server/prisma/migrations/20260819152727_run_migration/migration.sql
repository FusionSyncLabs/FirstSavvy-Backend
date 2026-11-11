/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `referrals` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[short_id]` on the table `referrals` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `referred_by_id` on the `referrals` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "referrals" DROP COLUMN "referred_by_id",
ADD COLUMN     "referred_by_id" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "referrals_code_key" ON "referrals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_short_id_key" ON "referrals"("short_id");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
