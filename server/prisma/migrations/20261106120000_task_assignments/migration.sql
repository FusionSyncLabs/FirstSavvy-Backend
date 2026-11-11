ALTER TABLE "tasks" ALTER COLUMN "assigned_to_child_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "task_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "child_profile_id" UUID NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'pending',
  "completed_at" TIMESTAMPTZ(6),
  "approved_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_assignments_task_id_child_profile_id_key"
  ON "task_assignments"("task_id", "child_profile_id");
CREATE INDEX IF NOT EXISTS "task_assignments_child_profile_id_status_idx"
  ON "task_assignments"("child_profile_id", "status");

ALTER TABLE "task_assignments"
  DROP CONSTRAINT IF EXISTS "task_assignments_task_id_fkey";
ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_assignments"
  DROP CONSTRAINT IF EXISTS "task_assignments_child_profile_id_fkey";
ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_child_profile_id_fkey"
  FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "task_assignments" ("task_id", "child_profile_id", "status", "completed_at", "approved_at", "rejected_at", "is_active")
SELECT "id", "assigned_to_child_id", "status", "completed_at", "approved_at", "rejected_at", "is_active"
FROM "tasks"
WHERE "assigned_to_child_id" IS NOT NULL
ON CONFLICT ("task_id", "child_profile_id") DO NOTHING;
