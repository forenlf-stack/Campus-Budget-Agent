-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "openingBalanceCents" INTEGER NOT NULL CHECK ("openingBalanceCents" >= 0),
    "balanceAsOf" DATETIME NOT NULL,
    "expectedMonthlyIncomeCents" INTEGER NOT NULL CHECK ("expectedMonthlyIncomeCents" >= 0),
    "fixedMonthlyExpenseCents" INTEGER NOT NULL CHECK ("fixedMonthlyExpenseCents" >= 0),
    "emergencyReserveCents" INTEGER NOT NULL CHECK ("emergencyReserveCents" >= 0),
    "savingsTargetCents" INTEGER NOT NULL CHECK ("savingsTargetCents" >= 0),
    "savingsTargetDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL CHECK ("category" IN ('MEAL', 'SNACK_DRINK', 'DAILY_NECESSITY', 'STUDY', 'TRANSPORT', 'GAME_ENTERTAINMENT', 'RECHARGE_SUBSCRIPTION', 'MEDICAL', 'OTHER')),
    "periodStart" DATETIME NOT NULL,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CategoryBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "maxSingleMealCents" INTEGER NOT NULL CHECK ("maxSingleMealCents" >= 0),
    "maxSingleSnackDrinkCents" INTEGER NOT NULL CHECK ("maxSingleSnackDrinkCents" >= 0),
    "monthlyEntertainmentLimitCents" INTEGER NOT NULL CHECK ("monthlyEntertainmentLimitCents" >= 0),
    "priceSensitivity" TEXT NOT NULL CHECK ("priceSensitivity" IN ('LOW', 'MEDIUM', 'HIGH')),
    "prioritizeNeeds" BOOLEAN NOT NULL,
    "foodLikes" TEXT NOT NULL,
    "foodDislikes" TEXT NOT NULL,
    "foodAllergens" TEXT NOT NULL,
    "preferredDailyNecessities" TEXT NOT NULL,
    "avoidedBrands" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('INCOME', 'EXPENSE', 'REFUND')),
    "category" TEXT CHECK ("category" IS NULL OR "category" IN ('MEAL', 'SNACK_DRINK', 'DAILY_NECESSITY', 'STUDY', 'TRANSPORT', 'GAME_ENTERTAINMENT', 'RECHARGE_SUBSCRIPTION', 'MEDICAL', 'OTHER')),
    "source" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("source" IN ('MANUAL', 'CSV', 'AGENT')),
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "occurredAt" DATETIME NOT NULL,
    "itemName" TEXT NOT NULL,
    "merchant" TEXT,
    "note" TEXT,
    "originalTransactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK (("type" = 'INCOME' AND "category" IS NULL AND "originalTransactionId" IS NULL) OR ("type" = 'EXPENSE' AND "category" IS NOT NULL AND "originalTransactionId" IS NULL) OR ("type" = 'REFUND' AND "category" IS NOT NULL AND "originalTransactionId" IS NOT NULL)),
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_originalTransactionId_fkey" FOREIGN KEY ("originalTransactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CategoryBudget_userId_periodStart_idx" ON "CategoryBudget"("userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBudget_userId_category_periodStart_key" ON "CategoryBudget"("userId", "category", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_category_occurredAt_idx" ON "Transaction"("userId", "category", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_originalTransactionId_idx" ON "Transaction"("originalTransactionId");
