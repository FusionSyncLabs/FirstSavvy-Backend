-- Replace constrained calendar strings with database enums and a boolean schedule status.
CREATE TYPE "RecurringScheduleType" AS ENUM ('expense', 'income', 'transfer', 'reminder');
CREATE TYPE "RecurringScheduleCadence" AS ENUM ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom');
CREATE TYPE "RecurringOccurrenceStatus" AS ENUM ('upcoming', 'due', 'overdue', 'confirmed', 'matched', 'skipped', 'cancelled');

ALTER TABLE "recurring_schedules"
  ALTER COLUMN "schedule_type" TYPE "RecurringScheduleType" USING "schedule_type"::"RecurringScheduleType",
  ALTER COLUMN "cadence" TYPE "RecurringScheduleCadence" USING "cadence"::"RecurringScheduleCadence";

ALTER TABLE "recurring_schedules"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE BOOLEAN USING CASE "status"
    WHEN 'active' THEN true
    WHEN 'paused' THEN false
    ELSE NULL
  END,
  ALTER COLUMN "status" SET DEFAULT true;

ALTER TABLE "recurring_occurrences"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "RecurringOccurrenceStatus" USING "status"::"RecurringOccurrenceStatus",
  ALTER COLUMN "status" SET DEFAULT 'upcoming'::"RecurringOccurrenceStatus";
