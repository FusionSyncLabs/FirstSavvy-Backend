-- CreateEnum
CREATE TYPE "OtpVerificationStatus" AS ENUM ('pending', 'verified', 'expired');

-- CreateTable
CREATE TABLE "OtpVerification" (
    "id" UUID NOT NULL,
    "otp" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "attempts" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "OtpVerificationStatus" NOT NULL DEFAULT 'pending',
    "user_id" UUID NOT NULL,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpVerification_otp_idx" ON "OtpVerification"("otp");

-- AddForeignKey
ALTER TABLE "OtpVerification" ADD CONSTRAINT "OtpVerification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
