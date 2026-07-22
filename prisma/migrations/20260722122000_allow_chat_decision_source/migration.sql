PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_DecisionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recommendationRunId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL CHECK (length(trim("itemName")) > 0),
    "source" TEXT NOT NULL CHECK ("source" IN ('HISTORY', 'MENU', 'SNACK', 'CHAT')),
    "outcome" TEXT NOT NULL CHECK ("outcome" IN ('PURCHASED', 'ABANDONED', 'REPLACED', 'DELAYED')),
    "recommendationType" TEXT NOT NULL,
    "recommendationRisk" TEXT NOT NULL,
    "recommendedPriceCents" INTEGER NOT NULL CHECK ("recommendedPriceCents" > 0),
    "actualPriceCents" INTEGER CHECK ("actualPriceCents" IS NULL OR "actualPriceCents" > 0),
    "occurredAt" DATETIME,
    "transactionId" TEXT,
    "remainingBudgetAfterCents" INTEGER,
    "mealRemainingAfterCents" INTEGER,
    "recommendedDailyBudgetAfterCents" INTEGER,
    "savingsTargetStillOnTrack" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK (("outcome" = 'PURCHASED' AND "actualPriceCents" IS NOT NULL AND "occurredAt" IS NOT NULL AND "transactionId" IS NOT NULL) OR ("outcome" != 'PURCHASED' AND "transactionId" IS NULL)),
    CONSTRAINT "DecisionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DecisionRecord_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_DecisionRecord" SELECT * FROM "DecisionRecord";
DROP TABLE "DecisionRecord";
ALTER TABLE "new_DecisionRecord" RENAME TO "DecisionRecord";

CREATE UNIQUE INDEX "DecisionRecord_transactionId_key" ON "DecisionRecord"("transactionId");
CREATE UNIQUE INDEX "DecisionRecord_userId_idempotencyKey_key" ON "DecisionRecord"("userId", "idempotencyKey");
CREATE INDEX "DecisionRecord_userId_createdAt_idx" ON "DecisionRecord"("userId", "createdAt");
CREATE INDEX "DecisionRecord_recommendationRunId_idx" ON "DecisionRecord"("recommendationRunId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
