CREATE TYPE "ChildFamilyRole" AS ENUM (
  'child',
  'spouse_partner',
  'parent',
  'sibling',
  'grandparent',
  'other'
);

UPDATE "child_profiles"
SET "family_role" = 'child'
WHERE "family_role" IS NULL
   OR "family_role" NOT IN (
    'child',
    'spouse_partner',
    'parent',
    'sibling',
    'grandparent',
    'other'
  );

ALTER TABLE "child_profiles"
  ALTER COLUMN "family_role" TYPE "ChildFamilyRole"
  USING "family_role"::"ChildFamilyRole";

ALTER TABLE "child_profiles"
  ALTER COLUMN "family_role" SET DEFAULT 'child',
  ALTER COLUMN "family_role" SET NOT NULL;
