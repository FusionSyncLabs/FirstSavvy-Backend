/*
  Warnings:

  - You are about to drop the `Events` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Events" DROP CONSTRAINT "Events_profile_id_fkey";

-- DropTable
DROP TABLE "Events";

-- CreateTable
CREATE TABLE "Event" (
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

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
