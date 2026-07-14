-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
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
    "isFixedExpense" BOOLEAN NOT NULL DEFAULT false,
    "originalTransactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK (("type" = 'INCOME' AND "category" IS NULL AND "originalTransactionId" IS NULL) OR ("type" = 'EXPENSE' AND "category" IS NOT NULL AND "originalTransactionId" IS NULL) OR ("type" = 'REFUND' AND "category" IS NOT NULL AND "originalTransactionId" IS NOT NULL)),
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_originalTransactionId_fkey" FOREIGN KEY ("originalTransactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amountCents", "category", "createdAt", "id", "itemName", "merchant", "note", "occurredAt", "originalTransactionId", "source", "type", "updatedAt", "userId") SELECT "amountCents", "category", "createdAt", "id", "itemName", "merchant", "note", "occurredAt", "originalTransactionId", "source", "type", "updatedAt", "userId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt");
CREATE INDEX "Transaction_userId_category_occurredAt_idx" ON "Transaction"("userId", "category", "occurredAt");
CREATE INDEX "Transaction_originalTransactionId_idx" ON "Transaction"("originalTransactionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
