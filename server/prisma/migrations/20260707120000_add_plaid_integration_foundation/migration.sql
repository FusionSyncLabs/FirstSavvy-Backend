CREATE TABLE "plaid_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "plaid_item_id" VARCHAR(255) NOT NULL,
  "access_token" TEXT NOT NULL,
  "institution_id" VARCHAR(255),
  "institution_name" VARCHAR(255),
  "products" JSONB NOT NULL DEFAULT '[]',
  "available_products" JSONB NOT NULL DEFAULT '[]',
  "billed_products" JSONB NOT NULL DEFAULT '[]',
  "transactions_cursor" TEXT,
  "status" VARCHAR(50) NOT NULL DEFAULT 'active',
  "last_synced_at" TIMESTAMPTZ(6),
  "error" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plaid_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "plaid_item_id" UUID NOT NULL,
  "plaid_account_id" VARCHAR(255) NOT NULL,
  "user_chart_account_id" UUID,
  "name" VARCHAR(255) NOT NULL,
  "official_name" VARCHAR(255),
  "mask" VARCHAR(32),
  "type" VARCHAR(100),
  "subtype" VARCHAR(100),
  "verification_status" VARCHAR(100),
  "current_balance" DECIMAL(14,2),
  "available_balance" DECIMAL(14,2),
  "iso_currency_code" VARCHAR(12),
  "unofficial_currency_code" VARCHAR(32),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "plaid_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plaid_items_plaid_item_id_key" ON "plaid_items"("plaid_item_id");
CREATE INDEX "plaid_items_profile_id_idx" ON "plaid_items"("profile_id");
CREATE INDEX "plaid_items_profile_id_status_idx" ON "plaid_items"("profile_id", "status");
CREATE INDEX "plaid_items_deleted_at_idx" ON "plaid_items"("deleted_at");

CREATE UNIQUE INDEX "plaid_accounts_plaid_account_id_key" ON "plaid_accounts"("plaid_account_id");
CREATE UNIQUE INDEX "plaid_accounts_user_chart_account_id_key" ON "plaid_accounts"("user_chart_account_id");
CREATE INDEX "plaid_accounts_profile_id_idx" ON "plaid_accounts"("profile_id");
CREATE INDEX "plaid_accounts_plaid_item_id_idx" ON "plaid_accounts"("plaid_item_id");
CREATE INDEX "plaid_accounts_user_chart_account_id_idx" ON "plaid_accounts"("user_chart_account_id");
CREATE INDEX "plaid_accounts_deleted_at_idx" ON "plaid_accounts"("deleted_at");

ALTER TABLE "plaid_items"
  ADD CONSTRAINT "plaid_items_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plaid_accounts"
  ADD CONSTRAINT "plaid_accounts_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plaid_accounts"
  ADD CONSTRAINT "plaid_accounts_plaid_item_id_fkey"
  FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plaid_accounts"
  ADD CONSTRAINT "plaid_accounts_user_chart_account_id_fkey"
  FOREIGN KEY ("user_chart_account_id") REFERENCES "user_chart_of_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
