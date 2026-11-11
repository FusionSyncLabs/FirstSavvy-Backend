-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('personal', 'household', 'business', 'real_estate', 'passive', 'holding_company', 'child', 'virtual');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'editor', 'viewer', 'child');

-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'posted', 'reviewed', 'excluded', 'deleted');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense', 'transfer', 'adjustment');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('draft', 'posted', 'voided');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'approved', 'rejected', 'active', 'archived');

-- CreateEnum
CREATE TYPE "TaskFrequency" AS ENUM ('one_time', 'daily', 'weekly', 'biweekly', 'monthly', 'always_available');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('available', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'redeemed');

-- CreateEnum
CREATE TYPE "AllowanceFrequency" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly');

-- CreateEnum
CREATE TYPE "CurrencyType" AS ENUM ('points', 'cash', 'stars');

-- CreateEnum
CREATE TYPE "VaultCategory" AS ENUM ('login', 'card', 'note', 'identity');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('view', 'edit');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT,
    "full_name" VARCHAR(255),
    "avatar_url" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "google_id" VARCHAR(255),
    "refresh_token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "profile_type" "ProfileType" NOT NULL DEFAULT 'personal',
    "family_role" VARCHAR(100),
    "avatar_url" TEXT,
    "color" VARCHAR(32),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_tabs" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "display_name" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_view_preferences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "view_name" VARCHAR(100) NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_view_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_profiles" (
    "id" UUID NOT NULL,
    "parent_profile_id" UUID NOT NULL,
    "parent_user_id" UUID,
    "auth_user_id" UUID,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "display_name" VARCHAR(255),
    "name" VARCHAR(255),
    "email" VARCHAR(320),
    "username" VARCHAR(100),
    "pin_hash" TEXT,
    "pin_length" INTEGER NOT NULL DEFAULT 4,
    "birth_date" DATE,
    "gender" VARCHAR(50),
    "avatar_url" TEXT,
    "profile_level" VARCHAR(50) NOT NULL DEFAULT 'beginner',
    "family_role" VARCHAR(100),
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "cash_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stars_balance" INTEGER NOT NULL DEFAULT 0,
    "stars_pending" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "child_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_access_grants" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "parent_profile_id" UUID NOT NULL,
    "granted_by_id" UUID,
    "role" VARCHAR(50) NOT NULL DEFAULT 'co_parent',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "parent_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_invitations" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "invited_email" VARCHAR(320) NOT NULL,
    "invitation_token" VARCHAR(255) NOT NULL,
    "invitation_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "invited_by_profile_id" UUID NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),

    CONSTRAINT "profile_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_shares" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "shared_with_profile_id" UUID NOT NULL,
    "permission_level" VARCHAR(50) NOT NULL DEFAULT 'view_only',
    "granted_by_profile_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "profile_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts_templates" (
    "id" UUID NOT NULL,
    "account_number" INTEGER NOT NULL,
    "account_name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "class" "AccountClass" NOT NULL,
    "account_type" VARCHAR(100),
    "parent_number" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_chart_of_accounts" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "template_account_number" INTEGER,
    "account_number" INTEGER,
    "account_name" VARCHAR(255),
    "display_name" VARCHAR(255),
    "class" "AccountClass" NOT NULL,
    "account_type" VARCHAR(100),
    "parent_account_id" UUID,
    "institution_name" VARCHAR(255),
    "account_mask" VARCHAR(32),
    "current_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "available_balance" DECIMAL(14,2),
    "opening_balance" DECIMAL(14,2),
    "include_in_cash_balance" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "bank_account_id" UUID,
    "category_account_id" UUID,
    "contact_id" UUID,
    "journal_entry_id" UUID,
    "date" DATE NOT NULL,
    "posted_date" DATE,
    "description" VARCHAR(500) NOT NULL,
    "original_description" VARCHAR(500),
    "amount" DECIMAL(14,2) NOT NULL,
    "transaction_type" "TransactionType",
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "memo" TEXT,
    "check_number" VARCHAR(50),
    "source" VARCHAR(100),
    "external_id" VARCHAR(255),
    "imported_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "chart_account_id" UUID,
    "name" VARCHAR(255),
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cadence" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "month" INTEGER,
    "year" INTEGER,
    "period_start" DATE,
    "period_end" DATE,
    "rollover_enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollover_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "parent_budget_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contact_type" VARCHAR(100),
    "email" VARCHAR(320),
    "phone" VARCHAR(50),
    "website" TEXT,
    "avatar_url" TEXT,
    "group_name" VARCHAR(100),
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_rules" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "pattern" TEXT,
    "pattern_type" VARCHAR(50),
    "category_account_id" UUID,
    "contact_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "apply_count" INTEGER NOT NULL DEFAULT 0,
    "last_applied_at" TIMESTAMPTZ(6),
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transaction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_splits" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "category_account_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transaction_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "entry_number" INTEGER,
    "entry_date" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "memo" TEXT,
    "source" VARCHAR(100),
    "source_transaction_id" UUID,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'posted',
    "created_by_user_id" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID,
    "description" VARCHAR(500),
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_attachments" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "profile_id" UUID,
    "user_id" UUID,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csv_column_mapping_configs" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "institution_name" VARCHAR(255) NOT NULL,
    "column_mappings" JSONB NOT NULL DEFAULT '{}',
    "date_format" VARCHAR(50) NOT NULL DEFAULT 'auto',
    "amount_type" VARCHAR(50) NOT NULL DEFAULT 'auto',
    "debit_column" VARCHAR(100) NOT NULL DEFAULT '',
    "credit_column" VARCHAR(100) NOT NULL DEFAULT '',
    "balance_column" VARCHAR(100) NOT NULL DEFAULT '',
    "use_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "csv_column_mapping_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "assigned_to_child_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "points_value" INTEGER NOT NULL DEFAULT 0,
    "star_reward" INTEGER NOT NULL DEFAULT 1,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "due_date" TIMESTAMPTZ(6),
    "frequency" "TaskFrequency" NOT NULL DEFAULT 'one_time',
    "recurrence_pattern" VARCHAR(50),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "next_recurrence_date" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "bonus_multiplier" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "streak_count" INTEGER NOT NULL DEFAULT 0,
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "profile_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "suggested_points" INTEGER NOT NULL DEFAULT 0,
    "suggested_stars" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(100),
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "age_group" VARCHAR(50),
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_completions" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'pending',
    "stars_earned" INTEGER NOT NULL DEFAULT 0,
    "submission_notes" TEXT,
    "review_notes" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "assigned_to_child_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "points_cost" INTEGER NOT NULL DEFAULT 0,
    "star_cost" INTEGER NOT NULL DEFAULT 10,
    "cash_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "category" VARCHAR(100),
    "icon" VARCHAR(100),
    "color" VARCHAR(32),
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_approval_threshold" INTEGER NOT NULL DEFAULT 100,
    "stock_quantity" INTEGER,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "status" "RewardStatus" NOT NULL DEFAULT 'available',
    "expires_at" TIMESTAMPTZ(6),
    "redeemed_at" TIMESTAMPTZ(6),
    "redeemed_by_child_id" UUID,
    "age_restriction" INTEGER,
    "created_by_user_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "points_spent" INTEGER NOT NULL DEFAULT 0,
    "stars_spent" INTEGER NOT NULL DEFAULT 0,
    "cash_spent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "RewardStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "fulfilled_at" TIMESTAMPTZ(6),
    "fulfilled_by_user_id" UUID,
    "rejection_reason" TEXT,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowance_schedules" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "frequency" "AllowanceFrequency" NOT NULL,
    "mode" VARCHAR(50) NOT NULL,
    "points_amount" INTEGER NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_payment_date" DATE NOT NULL,
    "last_payment_date" DATE,
    "created_by_user_id" UUID NOT NULL,
    "auto_deposit" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "allowance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_transactions" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "transaction_type" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency_type" "CurrencyType" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'completed',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "related_task_id" UUID,
    "related_reward_id" UUID,
    "related_allowance_id" UUID,
    "balance_after" DECIMAL(10,2),
    "category" VARCHAR(100),
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_login_audit_log" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "failure_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_login_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_achievements" (
    "id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "achievement_type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(100),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "earned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_folders" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "icon" VARCHAR(100) NOT NULL DEFAULT 'Folder',
    "color" VARCHAR(32) NOT NULL DEFAULT '#6B7280',
    "parent_folder_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vault_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_encryption_keys" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_encryption_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_items" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "folder_id" UUID,
    "category" "VaultCategory" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" TEXT,
    "username" TEXT,
    "password" TEXT,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vault_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_shares" (
    "id" UUID NOT NULL,
    "vault_item_id" UUID NOT NULL,
    "shared_by_user_id" UUID NOT NULL,
    "shared_with_user_id" UUID NOT NULL,
    "permission" "SharePermission" NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protected_configurations" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "config_key" VARCHAR(100) NOT NULL,
    "config_value" JSONB NOT NULL,
    "content_hash" VARCHAR(128),
    "is_protected" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "protected_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_change_log" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "configuration_id" UUID,
    "config_key" VARCHAR(100) NOT NULL,
    "changed_by" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_match_suggestions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "transaction_1_id" UUID NOT NULL,
    "transaction_2_id" UUID NOT NULL,
    "confidence_score" DECIMAL(5,2) NOT NULL,
    "match_reasons" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "auto_matched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_match_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_institutions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "logo_url" TEXT,
    "provider" VARCHAR(100),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(14,2),
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "profile_id" UUID,
    "uploaded_by" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER,
    "file_type" VARCHAR(100),
    "storage_path" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "profiles_owner_user_id_idx" ON "profiles"("owner_user_id");

-- CreateIndex
CREATE INDEX "profiles_owner_user_id_is_default_idx" ON "profiles"("owner_user_id", "is_default");

-- CreateIndex
CREATE INDEX "profiles_deleted_at_idx" ON "profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "profile_memberships_profile_id_idx" ON "profile_memberships"("profile_id");

-- CreateIndex
CREATE INDEX "profile_memberships_user_id_idx" ON "profile_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_memberships_user_id_profile_id_key" ON "profile_memberships"("user_id", "profile_id");

-- CreateIndex
CREATE INDEX "profile_tabs_owner_user_id_sort_order_idx" ON "profile_tabs"("owner_user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "profile_tabs_owner_user_id_profile_id_key" ON "profile_tabs"("owner_user_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_view_preferences_profile_id_view_name_key" ON "profile_view_preferences"("profile_id", "view_name");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "child_profiles_username_key" ON "child_profiles"("username");

-- CreateIndex
CREATE INDEX "child_profiles_parent_profile_id_idx" ON "child_profiles"("parent_profile_id");

-- CreateIndex
CREATE INDEX "child_profiles_parent_user_id_idx" ON "child_profiles"("parent_user_id");

-- CreateIndex
CREATE INDEX "child_profiles_deleted_at_idx" ON "child_profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "parent_access_grants_parent_profile_id_idx" ON "parent_access_grants"("parent_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_access_grants_child_profile_id_parent_profile_id_key" ON "parent_access_grants"("child_profile_id", "parent_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_invitations_invitation_token_key" ON "profile_invitations"("invitation_token");

-- CreateIndex
CREATE INDEX "profile_invitations_child_profile_id_idx" ON "profile_invitations"("child_profile_id");

-- CreateIndex
CREATE INDEX "profile_invitations_invited_email_idx" ON "profile_invitations"("invited_email");

-- CreateIndex
CREATE INDEX "profile_invitations_status_invitation_expires_at_idx" ON "profile_invitations"("status", "invitation_expires_at");

-- CreateIndex
CREATE INDEX "profile_invitations_invited_by_profile_id_idx" ON "profile_invitations"("invited_by_profile_id");

-- CreateIndex
CREATE INDEX "profile_shares_shared_with_profile_id_idx" ON "profile_shares"("shared_with_profile_id");

-- CreateIndex
CREATE INDEX "profile_shares_is_active_idx" ON "profile_shares"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "profile_shares_child_profile_id_shared_with_profile_id_key" ON "profile_shares"("child_profile_id", "shared_with_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_templates_account_number_key" ON "chart_of_accounts_templates"("account_number");

-- CreateIndex
CREATE INDEX "user_chart_of_accounts_profile_id_idx" ON "user_chart_of_accounts"("profile_id");

-- CreateIndex
CREATE INDEX "user_chart_of_accounts_profile_id_is_active_idx" ON "user_chart_of_accounts"("profile_id", "is_active");

-- CreateIndex
CREATE INDEX "user_chart_of_accounts_parent_account_id_idx" ON "user_chart_of_accounts"("parent_account_id");

-- CreateIndex
CREATE INDEX "user_chart_of_accounts_deleted_at_idx" ON "user_chart_of_accounts"("deleted_at");

-- CreateIndex
CREATE INDEX "transactions_profile_id_date_idx" ON "transactions"("profile_id", "date" DESC);

-- CreateIndex
CREATE INDEX "transactions_profile_id_status_idx" ON "transactions"("profile_id", "status");

-- CreateIndex
CREATE INDEX "transactions_profile_id_deleted_at_idx" ON "transactions"("profile_id", "deleted_at");

-- CreateIndex
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "transactions_category_account_id_idx" ON "transactions"("category_account_id");

-- CreateIndex
CREATE INDEX "transactions_journal_entry_id_idx" ON "transactions"("journal_entry_id");

-- CreateIndex
CREATE INDEX "transactions_profile_id_external_id_idx" ON "transactions"("profile_id", "external_id");

-- CreateIndex
CREATE INDEX "budgets_profile_id_idx" ON "budgets"("profile_id");

-- CreateIndex
CREATE INDEX "budgets_profile_id_year_month_idx" ON "budgets"("profile_id", "year", "month");

-- CreateIndex
CREATE INDEX "budgets_chart_account_id_idx" ON "budgets"("chart_account_id");

-- CreateIndex
CREATE INDEX "contacts_profile_id_idx" ON "contacts"("profile_id");

-- CreateIndex
CREATE INDEX "contacts_profile_id_deleted_at_idx" ON "contacts"("profile_id", "deleted_at");

-- CreateIndex
CREATE INDEX "transaction_rules_profile_id_is_active_priority_idx" ON "transaction_rules"("profile_id", "is_active", "priority" DESC);

-- CreateIndex
CREATE INDEX "transaction_splits_transaction_id_idx" ON "transaction_splits"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_splits_profile_id_idx" ON "transaction_splits"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_source_transaction_id_key" ON "journal_entries"("source_transaction_id");

-- CreateIndex
CREATE INDEX "journal_entries_profile_id_entry_date_idx" ON "journal_entries"("profile_id", "entry_date" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_profile_id_entry_number_idx" ON "journal_entries"("profile_id", "entry_number");

-- CreateIndex
CREATE INDEX "journal_entries_deleted_at_idx" ON "journal_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "journal_entry_lines_journal_entry_id_idx" ON "journal_entry_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_entry_attachments_journal_entry_id_idx" ON "journal_entry_attachments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "audit_logs_profile_id_created_at_idx" ON "audit_logs"("profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "csv_column_mapping_configs_profile_id_idx" ON "csv_column_mapping_configs"("profile_id");

-- CreateIndex
CREATE INDEX "csv_column_mapping_configs_profile_id_institution_name_idx" ON "csv_column_mapping_configs"("profile_id", "institution_name");

-- CreateIndex
CREATE INDEX "tasks_profile_id_idx" ON "tasks"("profile_id");

-- CreateIndex
CREATE INDEX "tasks_assigned_to_child_id_idx" ON "tasks"("assigned_to_child_id");

-- CreateIndex
CREATE INDEX "tasks_profile_id_status_idx" ON "tasks"("profile_id", "status");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "task_templates_is_public_idx" ON "task_templates"("is_public");

-- CreateIndex
CREATE INDEX "task_completions_task_id_idx" ON "task_completions"("task_id");

-- CreateIndex
CREATE INDEX "task_completions_child_profile_id_idx" ON "task_completions"("child_profile_id");

-- CreateIndex
CREATE INDEX "task_completions_status_idx" ON "task_completions"("status");

-- CreateIndex
CREATE INDEX "rewards_profile_id_idx" ON "rewards"("profile_id");

-- CreateIndex
CREATE INDEX "rewards_assigned_to_child_id_idx" ON "rewards"("assigned_to_child_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_child_profile_id_idx" ON "reward_redemptions"("child_profile_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_reward_id_idx" ON "reward_redemptions"("reward_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_status_idx" ON "reward_redemptions"("status");

-- CreateIndex
CREATE INDEX "allowance_schedules_child_profile_id_idx" ON "allowance_schedules"("child_profile_id");

-- CreateIndex
CREATE INDEX "allowance_schedules_next_payment_date_idx" ON "allowance_schedules"("next_payment_date");

-- CreateIndex
CREATE INDEX "child_transactions_child_profile_id_created_at_idx" ON "child_transactions"("child_profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "child_login_audit_log_child_profile_id_timestamp_idx" ON "child_login_audit_log"("child_profile_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "child_achievements_child_profile_id_idx" ON "child_achievements"("child_profile_id");

-- CreateIndex
CREATE INDEX "vault_folders_profile_id_idx" ON "vault_folders"("profile_id");

-- CreateIndex
CREATE INDEX "vault_folders_parent_folder_id_idx" ON "vault_folders"("parent_folder_id");

-- CreateIndex
CREATE UNIQUE INDEX "vault_encryption_keys_profile_id_key" ON "vault_encryption_keys"("profile_id");

-- CreateIndex
CREATE INDEX "vault_items_profile_id_idx" ON "vault_items"("profile_id");

-- CreateIndex
CREATE INDEX "vault_items_profile_id_deleted_at_idx" ON "vault_items"("profile_id", "deleted_at");

-- CreateIndex
CREATE INDEX "vault_items_user_id_idx" ON "vault_items"("user_id");

-- CreateIndex
CREATE INDEX "vault_shares_shared_with_user_id_idx" ON "vault_shares"("shared_with_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vault_shares_vault_item_id_shared_with_user_id_key" ON "vault_shares"("vault_item_id", "shared_with_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "protected_configurations_profile_id_config_key_key" ON "protected_configurations"("profile_id", "config_key");

-- CreateIndex
CREATE INDEX "configuration_change_log_profile_id_created_at_idx" ON "configuration_change_log"("profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transfer_match_suggestions_profile_id_status_idx" ON "transfer_match_suggestions"("profile_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_match_suggestions_transaction_1_id_transaction_2_i_key" ON "transfer_match_suggestions"("transaction_1_id", "transaction_2_id");

-- CreateIndex
CREATE INDEX "financial_institutions_is_active_idx" ON "financial_institutions"("is_active");

-- CreateIndex
CREATE INDEX "payment_reminders_profile_id_due_date_idx" ON "payment_reminders"("profile_id", "due_date");

-- CreateIndex
CREATE INDEX "payment_reminders_status_due_date_idx" ON "payment_reminders"("status", "due_date");

-- CreateIndex
CREATE INDEX "documents_profile_id_idx" ON "documents"("profile_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_memberships" ADD CONSTRAINT "profile_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_memberships" ADD CONSTRAINT "profile_memberships_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_tabs" ADD CONSTRAINT "profile_tabs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_tabs" ADD CONSTRAINT "profile_tabs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_view_preferences" ADD CONSTRAINT "profile_view_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_parent_profile_id_fkey" FOREIGN KEY ("parent_profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_access_grants" ADD CONSTRAINT "parent_access_grants_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_access_grants" ADD CONSTRAINT "parent_access_grants_parent_profile_id_fkey" FOREIGN KEY ("parent_profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_access_grants" ADD CONSTRAINT "parent_access_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_invitations" ADD CONSTRAINT "profile_invitations_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_invitations" ADD CONSTRAINT "profile_invitations_invited_by_profile_id_fkey" FOREIGN KEY ("invited_by_profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_shares" ADD CONSTRAINT "profile_shares_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_shares" ADD CONSTRAINT "profile_shares_shared_with_profile_id_fkey" FOREIGN KEY ("shared_with_profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_shares" ADD CONSTRAINT "profile_shares_granted_by_profile_id_fkey" FOREIGN KEY ("granted_by_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chart_of_accounts" ADD CONSTRAINT "user_chart_of_accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chart_of_accounts" ADD CONSTRAINT "user_chart_of_accounts_template_account_number_fkey" FOREIGN KEY ("template_account_number") REFERENCES "chart_of_accounts_templates"("account_number") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chart_of_accounts" ADD CONSTRAINT "user_chart_of_accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_account_id_fkey" FOREIGN KEY ("category_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_chart_account_id_fkey" FOREIGN KEY ("chart_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_parent_budget_id_fkey" FOREIGN KEY ("parent_budget_id") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_category_account_id_fkey" FOREIGN KEY ("category_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_account_id_fkey" FOREIGN KEY ("category_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_attachments" ADD CONSTRAINT "journal_entry_attachments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_attachments" ADD CONSTRAINT "journal_entry_attachments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_attachments" ADD CONSTRAINT "journal_entry_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csv_column_mapping_configs" ADD CONSTRAINT "csv_column_mapping_configs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_child_id_fkey" FOREIGN KEY ("assigned_to_child_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_assigned_to_child_id_fkey" FOREIGN KEY ("assigned_to_child_id") REFERENCES "child_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_redeemed_by_child_id_fkey" FOREIGN KEY ("redeemed_by_child_id") REFERENCES "child_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_fulfilled_by_user_id_fkey" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowance_schedules" ADD CONSTRAINT "allowance_schedules_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowance_schedules" ADD CONSTRAINT "allowance_schedules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transactions" ADD CONSTRAINT "child_transactions_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transactions" ADD CONSTRAINT "child_transactions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transactions" ADD CONSTRAINT "child_transactions_related_task_id_fkey" FOREIGN KEY ("related_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transactions" ADD CONSTRAINT "child_transactions_related_reward_id_fkey" FOREIGN KEY ("related_reward_id") REFERENCES "rewards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transactions" ADD CONSTRAINT "child_transactions_related_allowance_id_fkey" FOREIGN KEY ("related_allowance_id") REFERENCES "allowance_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_login_audit_log" ADD CONSTRAINT "child_login_audit_log_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_achievements" ADD CONSTRAINT "child_achievements_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_folders" ADD CONSTRAINT "vault_folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "vault_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_encryption_keys" ADD CONSTRAINT "vault_encryption_keys_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "vault_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_shares" ADD CONSTRAINT "vault_shares_vault_item_id_fkey" FOREIGN KEY ("vault_item_id") REFERENCES "vault_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_shares" ADD CONSTRAINT "vault_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_shares" ADD CONSTRAINT "vault_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protected_configurations" ADD CONSTRAINT "protected_configurations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protected_configurations" ADD CONSTRAINT "protected_configurations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protected_configurations" ADD CONSTRAINT "protected_configurations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_change_log" ADD CONSTRAINT "configuration_change_log_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_change_log" ADD CONSTRAINT "configuration_change_log_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "protected_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_change_log" ADD CONSTRAINT "configuration_change_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_match_suggestions" ADD CONSTRAINT "transfer_match_suggestions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_match_suggestions" ADD CONSTRAINT "transfer_match_suggestions_transaction_1_id_fkey" FOREIGN KEY ("transaction_1_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_match_suggestions" ADD CONSTRAINT "transfer_match_suggestions_transaction_2_id_fkey" FOREIGN KEY ("transaction_2_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Production constraints and extensions (beyond Prisma schema expressibility)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE UNIQUE INDEX "profiles_one_default_per_owner_idx"
  ON "profiles" ("owner_user_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

ALTER TABLE "transfer_match_suggestions"
  ADD CONSTRAINT "transfer_match_different_transactions_chk"
  CHECK ("transaction_1_id" <> "transaction_2_id");

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_debit_credit_chk"
  CHECK (
    ("debit" > 0 AND "credit" = 0) OR
    ("credit" > 0 AND "debit" = 0) OR
    ("debit" = 0 AND "credit" = 0)
  );

ALTER TABLE "child_profiles"
  ADD CONSTRAINT "child_profiles_points_non_negative_chk"
  CHECK ("points_balance" >= 0);

ALTER TABLE "child_profiles"
  ADD CONSTRAINT "child_profiles_stars_non_negative_chk"
  CHECK ("stars_balance" >= 0 AND "stars_pending" >= 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_points_non_negative_chk"
  CHECK ("points_value" >= 0 AND "star_reward" >= 0);

ALTER TABLE "rewards"
  ADD CONSTRAINT "rewards_has_cost_chk"
  CHECK ("points_cost" > 0 OR "star_cost" > 0 OR "cash_cost" > 0);

