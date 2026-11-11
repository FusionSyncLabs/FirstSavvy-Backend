CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SUB_ADMIN');
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUB_ADMIN',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "refresh_token_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");
CREATE INDEX "admins_role_idx" ON "admins"("role");
CREATE INDEX "admins_status_idx" ON "admins"("status");
CREATE INDEX "admins_created_by_id_idx" ON "admins"("created_by_id");
CREATE UNIQUE INDEX "admins_single_super_admin_key"
    ON "admins"("role")
    WHERE "role" = 'SUPER_ADMIN';

ALTER TABLE "admins"
    ADD CONSTRAINT "admins_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "admins"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
