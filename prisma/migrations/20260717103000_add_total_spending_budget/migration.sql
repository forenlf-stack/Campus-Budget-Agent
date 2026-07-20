ALTER TABLE "UserProfile" ADD COLUMN "monthlySpendingBudgetCents" INTEGER NOT NULL DEFAULT 0 CHECK ("monthlySpendingBudgetCents" >= 0);

UPDATE "UserProfile"
SET "monthlySpendingBudgetCents" = COALESCE((
  SELECT SUM("amountCents")
  FROM "CategoryBudget"
  WHERE "CategoryBudget"."userId" = "UserProfile"."id"
), 0);
