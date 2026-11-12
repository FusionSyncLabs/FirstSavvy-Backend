CREATE TABLE IF NOT EXISTS "admin_rate_limit_logs" (
    "id" BIGSERIAL NOT NULL,
    "limiter_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_rate_limit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_admin_rate_limit_logs_key_created_at" ON "admin_rate_limit_logs"("limiter_key", "created_at");