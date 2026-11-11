-- Safe Enum Update for PostgreSQL inside Prisma Transaction Blocks
CREATE TYPE "TransactionType_new" AS ENUM ('income', 'expense', 'transfer', 'asset_purchase', 'liability_payment', 'adjustment');

ALTER TABLE "transactions" ALTER COLUMN "transaction_type" TYPE "TransactionType_new" USING ("transaction_type"::text::"TransactionType_new");

DROP TYPE "TransactionType";

ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
