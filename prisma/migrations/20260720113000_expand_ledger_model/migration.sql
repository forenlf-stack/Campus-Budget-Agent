CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('WECHAT', 'ALIPAY', 'BANK', 'CASH', 'OTHER')),
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Account_userId_name_key" ON "Account"("userId", "name");
CREATE INDEX "Account_userId_enabled_idx" ON "Account"("userId", "enabled");

ALTER TABLE "Transaction" ADD COLUMN "accountId" TEXT REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD COLUMN "rawMerchant" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "rawItemName" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "rawReference" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "Transaction_userId_deletedAt_occurredAt_idx" ON "Transaction"("userId", "deletedAt", "occurredAt");
CREATE INDEX "Transaction_accountId_occurredAt_idx" ON "Transaction"("accountId", "occurredAt");

CREATE TABLE "AccountTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK ("fromAccountId" != "toAccountId"),
    CONSTRAINT "AccountTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AccountTransfer_userId_occurredAt_idx" ON "AccountTransfer"("userId", "occurredAt");
CREATE INDEX "AccountTransfer_fromAccountId_occurredAt_idx" ON "AccountTransfer"("fromAccountId", "occurredAt");
CREATE INDEX "AccountTransfer_toAccountId_occurredAt_idx" ON "AccountTransfer"("toAccountId", "occurredAt");

CREATE TABLE "ClassificationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "merchantPattern" TEXT NOT NULL,
    "itemPattern" TEXT,
    "normalizedMerchant" TEXT NOT NULL,
    "category" TEXT NOT NULL CHECK ("category" IN ('MEAL','SNACK_DRINK','DAILY_NECESSITY','STUDY','TRANSPORT','GAME_ENTERTAINMENT','RECHARGE_SUBSCRIPTION','MEDICAL','OTHER')),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassificationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClassificationRule_userId_merchantPattern_itemPattern_key" ON "ClassificationRule"("userId", "merchantPattern", "itemPattern");
CREATE INDEX "ClassificationRule_userId_enabled_priority_idx" ON "ClassificationRule"("userId", "enabled", "priority");

CREATE TABLE "RecurringBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('INCOME','EXPENSE')),
    "category" TEXT,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "itemName" TEXT NOT NULL,
    "merchant" TEXT,
    "accountId" TEXT,
    "note" TEXT,
    "isFixedExpense" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL CHECK ("frequency" IN ('WEEKLY','MONTHLY','YEARLY')),
    "nextDueAt" DATETIME NOT NULL,
    "reminderDays" INTEGER NOT NULL DEFAULT 3 CHECK ("reminderDays" BETWEEN 0 AND 30),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringBill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringBill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RecurringBill_userId_enabled_nextDueAt_idx" ON "RecurringBill"("userId", "enabled", "nextDueAt");

INSERT INTO "Account" ("id", "userId", "name", "type", "openingBalanceCents", "isDefault", "enabled", "createdAt", "updatedAt")
SELECT "id" || '-wechat', "id", '微信', 'WECHAT', 0, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "UserProfile";
INSERT INTO "Account" ("id", "userId", "name", "type", "openingBalanceCents", "isDefault", "enabled", "createdAt", "updatedAt")
SELECT "id" || '-alipay', "id", '支付宝', 'ALIPAY', 0, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "UserProfile";
INSERT INTO "Account" ("id", "userId", "name", "type", "openingBalanceCents", "isDefault", "enabled", "createdAt", "updatedAt")
SELECT "id" || '-bank', "id", '银行卡', 'BANK', 0, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "UserProfile";
INSERT INTO "Account" ("id", "userId", "name", "type", "openingBalanceCents", "isDefault", "enabled", "createdAt", "updatedAt")
SELECT "id" || '-cash', "id", '现金', 'CASH', 0, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "UserProfile";
