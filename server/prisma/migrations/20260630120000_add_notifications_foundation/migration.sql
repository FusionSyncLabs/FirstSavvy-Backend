CREATE TYPE "NotificationPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "recipient_user_id" UUID,
    "source" VARCHAR(100) NOT NULL,
    "source_id" VARCHAR(255),
    "event_type" VARCHAR(100) NOT NULL,
    "delivery_key" VARCHAR(255),
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "action_url" TEXT,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'normal',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "read_by_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_delivery_key_key" ON "notifications"("delivery_key");
CREATE INDEX "notifications_profile_id_read_at_created_at_idx" ON "notifications"("profile_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_profile_id_source_event_type_idx" ON "notifications"("profile_id", "source", "event_type");
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_read_by_id_fkey" FOREIGN KEY ("read_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
