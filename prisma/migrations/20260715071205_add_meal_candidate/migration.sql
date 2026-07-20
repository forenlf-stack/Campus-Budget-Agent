-- CreateTable
CREATE TABLE "MealCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchant" TEXT NOT NULL CHECK (length(trim("merchant")) > 0),
    "typicalPriceCents" INTEGER NOT NULL CHECK ("typicalPriceCents" > 0),
    "location" TEXT NOT NULL CHECK (length(trim("location")) > 0),
    "mealPeriod" TEXT NOT NULL CHECK ("mealPeriod" IN ('BREAKFAST', 'LUNCH', 'DINNER', 'ALL_DAY')),
    "tags" TEXT NOT NULL CHECK (json_valid("tags") AND json_type("tags") = 'array'),
    "ingredients" TEXT NOT NULL CHECK (json_valid("ingredients") AND json_type("ingredients") = 'array'),
    "isSpicy" BOOLEAN NOT NULL DEFAULT false,
    "userRating" INTEGER CHECK ("userRating" IS NULL OR "userRating" BETWEEN 1 AND 5),
    "lastPurchasedAt" DATETIME,
    "priceUpdatedAt" DATETIME NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("dataSource" IN ('MANUAL', 'SEED')),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MealCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MealCandidate_userId_location_mealPeriod_enabled_idx" ON "MealCandidate"("userId", "location", "mealPeriod", "enabled");

-- CreateIndex
CREATE INDEX "MealCandidate_userId_enabled_updatedAt_idx" ON "MealCandidate"("userId", "enabled", "updatedAt");
