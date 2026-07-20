ALTER TABLE "UserProfile" ADD COLUMN "email" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';

UPDATE "UserProfile"
SET "email" = CASE
  WHEN "id" = 'user_demo_001' THEN 'demo@budget.local'
  ELSE "id" || '@budget.local'
END;

UPDATE "UserProfile"
SET "passwordHash" = 'scrypt$0123456789abcdef0123456789abcdef$b1fe5581679c0102cfc40717999f706a3b365d0046be2327db9aaf4af5e8c86bb225db0d2c3abd494fda18e8eab6b683d6c52ec0c446f04e31766fd578263643'
WHERE "id" = 'user_demo_001';

CREATE UNIQUE INDEX "UserProfile_email_key" ON "UserProfile"("email");

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
