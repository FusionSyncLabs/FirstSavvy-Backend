-- AlterTable safely
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "email_verified_at" TO "verified_at";
  END IF;
END $$;
