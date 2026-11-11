-- AlterTable
ALTER TABLE "user_chart_of_accounts" 
  ADD COLUMN IF NOT EXISTS "opening_balance_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "bank_current_balance" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "bank_available_balance" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "bank_balance_synced_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "plaid_import_start_date" DATE,
  ADD COLUMN IF NOT EXISTS "reconciliation_variance" DECIMAL(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_reconciled_at" TIMESTAMPTZ(6);
