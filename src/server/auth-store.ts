import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { AuthUser, LoginInput, RegisterInput } from "@/lib/auth";
import { openDatabase } from "@/server/database";

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function userFromRow(row: Record<string, unknown>): AuthUser {
  return { id: String(row.id), displayName: String(row.displayName), email: String(row.email) };
}

export async function registerUser(input: RegisterInput): Promise<AuthUser> {
  const database = openDatabase();
  const userId = randomUUID();
  const preferenceId = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare(`SELECT "id" FROM "UserProfile" WHERE lower("email") = lower(?)`).get(input.email);
    if (existing) throw new Error("该邮箱已经注册");
    database.prepare(`
      INSERT INTO "UserProfile" (
        "id", "displayName", "email", "passwordHash", "openingBalanceCents", "balanceAsOf",
        "expectedMonthlyIncomeCents", "monthlySpendingBudgetCents", "fixedMonthlyExpenseCents",
        "emergencyReserveCents", "savingsTargetCents", "savingsTargetDate", "allowanceDay",
        "defaultLocation", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, 0, 0, NULL, 1, '', ?, ?)
    `).run(userId, input.displayName, input.email, passwordHash, now, now, now);
    database.prepare(`
      INSERT INTO "UserPreference" (
        "id", "userId", "maxSingleMealCents", "maxSingleSnackDrinkCents",
        "monthlyEntertainmentLimitCents", "recommendedLunchPriceCents", "weeklySnackDrinkLimit",
        "weeklySnackDrinkBudgetCents", "shoppingReminderThresholdCents", "coolingOffHours",
        "priceSensitivity", "prioritizeNeeds", "foodLikes", "foodDislikes", "foodAllergens",
        "preferredDailyNecessities", "avoidedBrands", "protectedCategories", "notes", "createdAt", "updatedAt"
      ) VALUES (?, ?, 3000, 1500, 0, 1800, 3, 3000, 5000, 24, 'MEDIUM', 1, '[]', '[]', '[]', '[]', '[]', ?, NULL, ?, ?)
    `).run(preferenceId, userId, JSON.stringify(["MEAL", "DAILY_NECESSITY", "STUDY", "TRANSPORT", "MEDICAL"]), now, now);
    database.exec("COMMIT");
    return { id: userId, displayName: input.displayName, email: input.email };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  } finally {
    database.close();
  }
}

export async function authenticateUser(input: LoginInput): Promise<AuthUser | null> {
  const database = openDatabase();
  try {
    const row = database.prepare(`SELECT "id", "displayName", "email", "passwordHash" FROM "UserProfile" WHERE lower("email") = lower(?)`).get(input.email) as Record<string, unknown> | undefined;
    if (!row || !await verifyPassword(input.password, String(row.passwordHash))) return null;
    return userFromRow(row);
  } finally { database.close(); }
}

export function createSession(userId: string) {
  const database = openDatabase();
  try {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionLifetimeMs);
    database.prepare(`DELETE FROM "UserSession" WHERE "expiresAt" <= ?`).run(now.toISOString());
    database.prepare(`INSERT INTO "UserSession" ("id", "userId", "tokenHash", "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), userId, tokenHash(token), expiresAt.toISOString(), now.toISOString(), now.toISOString());
    return { token, expiresAt };
  } finally { database.close(); }
}

export function readSession(token: string): AuthUser | null {
  const database = openDatabase();
  try {
    const row = database.prepare(`
      SELECT user."id", user."displayName", user."email"
      FROM "UserSession" session
      JOIN "UserProfile" user ON user."id" = session."userId"
      WHERE session."tokenHash" = ? AND session."expiresAt" > ?
    `).get(tokenHash(token), new Date().toISOString()) as Record<string, unknown> | undefined;
    return row ? userFromRow(row) : null;
  } finally { database.close(); }
}

export function deleteSession(token: string) {
  const database = openDatabase();
  try { database.prepare(`DELETE FROM "UserSession" WHERE "tokenHash" = ?`).run(tokenHash(token)); }
  finally { database.close(); }
}
