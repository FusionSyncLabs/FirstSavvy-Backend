-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'Entree',
    "prep_time" INTEGER DEFAULT 30,
    "description" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "ingredients" JSONB NOT NULL DEFAULT '[]',
    "instructions" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plans" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal_type" VARCHAR(50) NOT NULL,
    "course" VARCHAR(50) NOT NULL DEFAULT 'entree',
    "dish_name" VARCHAR(255) NOT NULL,
    "recipe_id" UUID,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipes_profile_id_idx" ON "recipes"("profile_id");

-- CreateIndex
CREATE INDEX "recipes_profile_id_type_idx" ON "recipes"("profile_id", "type");

-- CreateIndex
CREATE INDEX "meal_plans_profile_id_idx" ON "meal_plans"("profile_id");

-- CreateIndex
CREATE INDEX "meal_plans_profile_id_date_idx" ON "meal_plans"("profile_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_name_idx" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_deleted_at_idx" ON "Category"("deleted_at");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
