-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "maxSingleMealCents" INTEGER NOT NULL CHECK ("maxSingleMealCents" >= 0),
    "maxSingleSnackDrinkCents" INTEGER NOT NULL CHECK ("maxSingleSnackDrinkCents" >= 0),
    "monthlyEntertainmentLimitCents" INTEGER NOT NULL CHECK ("monthlyEntertainmentLimitCents" >= 0),
    "recommendedLunchPriceCents" INTEGER NOT NULL DEFAULT 0 CHECK ("recommendedLunchPriceCents" >= 0),
    "weeklySnackDrinkLimit" INTEGER NOT NULL DEFAULT 0 CHECK ("weeklySnackDrinkLimit" >= 0),
    "weeklySnackDrinkBudgetCents" INTEGER NOT NULL DEFAULT 0 CHECK ("weeklySnackDrinkBudgetCents" >= 0),
    "shoppingReminderThresholdCents" INTEGER NOT NULL DEFAULT 0 CHECK ("shoppingReminderThresholdCents" >= 0),
    "coolingOffHours" INTEGER NOT NULL DEFAULT 0 CHECK ("coolingOffHours" >= 0),
    "priceSensitivity" TEXT NOT NULL CHECK ("priceSensitivity" IN ('LOW', 'MEDIUM', 'HIGH')),
    "prioritizeNeeds" BOOLEAN NOT NULL,
    "foodLikes" TEXT NOT NULL,
    "foodDislikes" TEXT NOT NULL,
    "foodAllergens" TEXT NOT NULL,
    "preferredDailyNecessities" TEXT NOT NULL,
    "avoidedBrands" TEXT NOT NULL,
    "protectedCategories" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserPreference" ("avoidedBrands", "createdAt", "foodAllergens", "foodDislikes", "foodLikes", "id", "maxSingleMealCents", "maxSingleSnackDrinkCents", "monthlyEntertainmentLimitCents", "notes", "preferredDailyNecessities", "priceSensitivity", "prioritizeNeeds", "updatedAt", "userId") SELECT "avoidedBrands", "createdAt", "foodAllergens", "foodDislikes", "foodLikes", "id", "maxSingleMealCents", "maxSingleSnackDrinkCents", "monthlyEntertainmentLimitCents", "notes", "preferredDailyNecessities", "priceSensitivity", "prioritizeNeeds", "updatedAt", "userId" FROM "UserPreference";
DROP TABLE "UserPreference";
ALTER TABLE "new_UserPreference" RENAME TO "UserPreference";
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");
CREATE TABLE "new_UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "openingBalanceCents" INTEGER NOT NULL CHECK ("openingBalanceCents" >= 0),
    "balanceAsOf" DATETIME NOT NULL,
    "expectedMonthlyIncomeCents" INTEGER NOT NULL CHECK ("expectedMonthlyIncomeCents" >= 0),
    "fixedMonthlyExpenseCents" INTEGER NOT NULL CHECK ("fixedMonthlyExpenseCents" >= 0),
    "emergencyReserveCents" INTEGER NOT NULL CHECK ("emergencyReserveCents" >= 0),
    "savingsTargetCents" INTEGER NOT NULL CHECK ("savingsTargetCents" >= 0),
    "savingsTargetDate" DATETIME,
    "allowanceDay" INTEGER NOT NULL DEFAULT 1 CHECK ("allowanceDay" BETWEEN 1 AND 31),
    "defaultLocation" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UserProfile" ("balanceAsOf", "createdAt", "displayName", "emergencyReserveCents", "expectedMonthlyIncomeCents", "fixedMonthlyExpenseCents", "id", "openingBalanceCents", "savingsTargetCents", "savingsTargetDate", "updatedAt") SELECT "balanceAsOf", "createdAt", "displayName", "emergencyReserveCents", "expectedMonthlyIncomeCents", "fixedMonthlyExpenseCents", "id", "openingBalanceCents", "savingsTargetCents", "savingsTargetDate", "updatedAt" FROM "UserProfile";
DROP TABLE "UserProfile";
ALTER TABLE "new_UserProfile" RENAME TO "UserProfile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
