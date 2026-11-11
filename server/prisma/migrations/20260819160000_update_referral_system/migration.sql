-- Update User model to add referral_code field
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" TEXT;

-- Create index on referral_code for faster lookups
CREATE INDEX IF NOT EXISTS "users_referral_code_idx" ON "users"("referral_code");

-- Update existing Referral table to match new schema
-- Add used_by column if it doesn't exist
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "used_by" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Update status column to be TEXT with default
ALTER TABLE "referrals" ALTER COLUMN "status" SET DEFAULT 'active';

-- Update expires_at to use TIMESTAMPTZ
ALTER TABLE "referrals" ALTER COLUMN "expires_at" TYPE TIMESTAMP(6) WITH TIME ZONE USING "expires_at"::TIMESTAMP(6) WITH TIME ZONE;

-- Update description column length
ALTER TABLE "referrals" ALTER COLUMN "description" TYPE TEXT;

-- Ensure proper indexes exist
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_code_key" ON "referrals"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_short_id_key" ON "referrals"("short_id");

-- Create performance indexes if they don't exist
CREATE INDEX IF NOT EXISTS "referrals_short_id_idx" ON "referrals"("short_id");
CREATE INDEX IF NOT EXISTS "referrals_code_idx" ON "referrals"("code");
CREATE INDEX IF NOT EXISTS "referrals_referred_by_id_idx" ON "referrals"("referred_by_id");
CREATE INDEX IF NOT EXISTS "referrals_status_expires_at_idx" ON "referrals"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "referrals_deleted_at_idx" ON "referrals"("deleted_at");

-- Ensure foreign key constraint exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'referrals_referred_by_id_fkey'
    ) THEN
        ALTER TABLE "referrals" 
        ADD CONSTRAINT "referrals_referred_by_id_fkey" 
        FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;