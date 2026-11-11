-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'completed', 'paused', 'archived');

-- CreateTable
CREATE TABLE "financial_goals" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "child_profile_id" UUID,
    "linked_account_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "target_date" DATE,
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "contribution_date" DATE NOT NULL,
    "transaction_id" UUID NOT NULL,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_goals_profile_id_idx" ON "financial_goals"("profile_id");

-- CreateIndex
CREATE INDEX "financial_goals_profile_id_status_idx" ON "financial_goals"("profile_id", "status");

-- CreateIndex
CREATE INDEX "financial_goals_profile_id_deleted_at_idx" ON "financial_goals"("profile_id", "deleted_at");

-- CreateIndex
CREATE INDEX "financial_goals_linked_account_id_idx" ON "financial_goals"("linked_account_id");

-- CreateIndex
CREATE INDEX "financial_goals_child_profile_id_idx" ON "financial_goals"("child_profile_id");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_idx" ON "goal_contributions"("goal_id");

-- CreateIndex
CREATE INDEX "goal_contributions_profile_id_idx" ON "goal_contributions"("profile_id");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_contribution_date_idx" ON "goal_contributions"("goal_id", "contribution_date");

-- CreateIndex
CREATE INDEX "goal_contributions_transaction_id_idx" ON "goal_contributions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_contributions_active_transaction_id_key" ON "goal_contributions"("transaction_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "financial_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
