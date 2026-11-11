-- AlterTable
ALTER TABLE "chart_of_accounts_templates" ADD COLUMN "account_detail" VARCHAR(100),
ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "is_editable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_chart_of_accounts" ADD COLUMN "account_detail" VARCHAR(100),
ADD COLUMN "is_user_created" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "chart_of_accounts_templates_class_sort_order_idx" ON "chart_of_accounts_templates"("class", "sort_order");

-- Align defaults with production schema expectations
ALTER TABLE "chart_of_accounts_templates" ALTER COLUMN "is_system" SET DEFAULT true;
