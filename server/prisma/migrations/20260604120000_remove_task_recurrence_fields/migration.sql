ALTER TABLE "tasks" DROP COLUMN IF EXISTS "frequency";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "recurrence_pattern";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "is_recurring";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "repeatable";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "next_recurrence_date";

DROP TYPE IF EXISTS "TaskFrequency";
