-- AlterTable
ALTER TABLE "transaction_splits" ADD COLUMN IF NOT EXISTS "contact_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transaction_splits_contact_id_idx" ON "transaction_splits"("contact_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transaction_splits_contact_id_fkey'
  ) THEN
    ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
