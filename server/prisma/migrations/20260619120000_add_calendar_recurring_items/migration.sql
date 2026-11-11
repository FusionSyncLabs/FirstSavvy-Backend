-- Financial calendar schedules are planning records. They do not post ledger transactions.
CREATE TABLE "recurring_schedules" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "schedule_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "cadence" VARCHAR(50) NOT NULL,
    "recurrence_rule" VARCHAR(500),
    "custom_interval_days" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "expected_amount" DECIMAL(14,2),
    "bank_account_id" UUID,
    "category_account_id" UUID,
    "contact_id" UUID,
    "reminder_offsets" INTEGER[] NOT NULL DEFAULT ARRAY[7, 3, 1, 0],
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurring_occurrences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "expected_amount" DECIMAL(14,2),
    "status" VARCHAR(50) NOT NULL DEFAULT 'upcoming',
    "linked_transaction_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "skipped_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "recurring_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_notifications" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "delivery_key" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "due_date" DATE NOT NULL,
    "reminder_offset_days" INTEGER NOT NULL,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calendar_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_occurrences_schedule_id_occurrence_date_key" ON "recurring_occurrences"("schedule_id", "occurrence_date");
CREATE UNIQUE INDEX "recurring_occurrences_linked_transaction_id_key" ON "recurring_occurrences"("linked_transaction_id");
CREATE UNIQUE INDEX "calendar_notifications_delivery_key_key" ON "calendar_notifications"("delivery_key");
CREATE INDEX "recurring_schedules_profile_id_status_idx" ON "recurring_schedules"("profile_id", "status");
CREATE INDEX "recurring_schedules_profile_id_start_date_idx" ON "recurring_schedules"("profile_id", "start_date");
CREATE INDEX "recurring_schedules_deleted_at_idx" ON "recurring_schedules"("deleted_at");
CREATE INDEX "recurring_occurrences_profile_id_occurrence_date_idx" ON "recurring_occurrences"("profile_id", "occurrence_date");
CREATE INDEX "recurring_occurrences_profile_id_status_occurrence_date_idx" ON "recurring_occurrences"("profile_id", "status", "occurrence_date");
CREATE INDEX "calendar_notifications_profile_id_acknowledged_at_due_date_idx" ON "calendar_notifications"("profile_id", "acknowledged_at", "due_date");
CREATE INDEX "calendar_notifications_occurrence_id_idx" ON "calendar_notifications"("occurrence_id");

ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_category_account_id_fkey" FOREIGN KEY ("category_account_id") REFERENCES "user_chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_linked_transaction_id_fkey" FOREIGN KEY ("linked_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_notifications" ADD CONSTRAINT "calendar_notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_notifications" ADD CONSTRAINT "calendar_notifications_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_notifications" ADD CONSTRAINT "calendar_notifications_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "recurring_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_notifications" ADD CONSTRAINT "calendar_notifications_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
