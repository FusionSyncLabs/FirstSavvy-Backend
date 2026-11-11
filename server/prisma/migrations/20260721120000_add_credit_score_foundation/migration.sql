CREATE TYPE "CreditVerificationProvider" AS ENUM ('mock', 'stripe_identity', 'experian');
CREATE TYPE "CreditVerificationStatus" AS ENUM ('pending', 'verified', 'failed', 'expired');
CREATE TYPE "CreditScoreBand" AS ENUM ('poor', 'fair', 'good', 'very_good', 'exceptional');
CREATE TYPE "CreditScoreSource" AS ENUM ('manual_refresh', 'scheduled');

CREATE TABLE "credit_verifications" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "CreditVerificationProvider" NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "status" "CreditVerificationStatus" NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "credit_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_scores" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "score_band" "CreditScoreBand" NOT NULL,
    "bureau" VARCHAR(50),
    "factors" JSONB NOT NULL,
    "pulled_at" TIMESTAMPTZ(6) NOT NULL,
    "source" "CreditScoreSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "credit_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_scores_score_check" CHECK ("score" >= 300 AND "score" <= 850)
);

CREATE UNIQUE INDEX "credit_verifications_profile_id_key" ON "credit_verifications"("profile_id");
CREATE INDEX "credit_verifications_user_id_idx" ON "credit_verifications"("user_id");
CREATE INDEX "credit_verifications_deleted_at_idx" ON "credit_verifications"("deleted_at");
CREATE INDEX "credit_scores_profile_id_pulled_at_idx" ON "credit_scores"("profile_id", "pulled_at" DESC);
CREATE INDEX "credit_scores_deleted_at_idx" ON "credit_scores"("deleted_at");

ALTER TABLE "credit_verifications" ADD CONSTRAINT "credit_verifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_verifications" ADD CONSTRAINT "credit_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
