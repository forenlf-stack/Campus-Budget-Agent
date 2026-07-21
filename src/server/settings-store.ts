import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { calculateCurrentBalanceCents } from "@/lib/balance";
import { settingsSchema, storedSettingsSchema, type SettingsInput } from "@/lib/settings";

function openDatabase() {
  const database = new DatabaseSync(path.join(process.cwd(), "dev.db"));
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function parseList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function getCurrentPeriod(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function readSettings(userId: string, period = getCurrentPeriod()): SettingsInput {
  const database = openDatabase();
  try {
    const profile = database.prepare(`
      SELECT "openingBalanceCents", "balanceAsOf", "expectedMonthlyIncomeCents", "fixedMonthlyExpenseCents",
             "emergencyReserveCents", "savingsTargetCents", "monthlySpendingBudgetCents", "allowanceDay", "defaultLocation"
      FROM "UserProfile" WHERE "id" = ?
    `).get(userId) as Record<string, unknown> | undefined;
    const preference = database.prepare(`
      SELECT "maxSingleMealCents", "recommendedLunchPriceCents", "weeklySnackDrinkLimit",
             "weeklySnackDrinkBudgetCents", "shoppingReminderThresholdCents", "coolingOffHours",
             "foodLikes", "foodDislikes", "foodAllergens", "protectedCategories"
      FROM "UserPreference" WHERE "userId" = ?
    `).get(userId) as Record<string, unknown> | undefined;
    if (!profile || !preference) {
      throw new Error("未找到单用户配置，请先执行数据库种子命令");
    }
    const now = new Date();
    const balanceAsOf = new Date(String(profile.balanceAsOf));
    const delta = database.prepare(`
      SELECT COALESCE(SUM(CASE WHEN "type" = 'EXPENSE' THEN -"amountCents" ELSE "amountCents" END), 0) AS "total"
      FROM "Transaction"
      WHERE "userId" = ? AND "deletedAt" IS NULL AND "occurredAt" > ? AND "occurredAt" <= ?
    `).get(userId, balanceAsOf.toISOString(), now.toISOString()) as { total: number };
    const currentBalanceCents = calculateCurrentBalanceCents({
      openingBalanceCents: Number(profile.openingBalanceCents),
      balanceAsOf,
      now,
      monthlyAllowanceCents: Number(profile.expectedMonthlyIncomeCents),
      allowanceDay: Number(profile.allowanceDay),
      transactionDeltaCents: delta.total,
    });
    return storedSettingsSchema.parse({
      period,
      monthlyAllowanceCents: profile.expectedMonthlyIncomeCents,
      currentBalanceCents,
      fixedExpenseCents: profile.fixedMonthlyExpenseCents,
      monthlySavingsTargetCents: profile.savingsTargetCents,
      requiredReserveCents: profile.emergencyReserveCents,
      totalBudgetCents: profile.monthlySpendingBudgetCents,
      allowanceDay: profile.allowanceDay,
      defaultLocation: profile.defaultLocation,
      recommendedLunchPriceCents: preference.recommendedLunchPriceCents,
      lunchHardLimitCents: preference.maxSingleMealCents,
      weeklySnackDrinkLimit: preference.weeklySnackDrinkLimit,
      weeklySnackDrinkBudgetCents: preference.weeklySnackDrinkBudgetCents,
      shoppingReminderThresholdCents: preference.shoppingReminderThresholdCents,
      coolingOffHours: preference.coolingOffHours,
      foodLikes: parseList(preference.foodLikes),
      foodDislikes: parseList(preference.foodDislikes),
      foodAllergens: parseList(preference.foodAllergens),
      protectedCategories: parseList(preference.protectedCategories),
    });
  } finally {
    database.close();
  }
}

export function saveSettings(userId: string, input: SettingsInput): SettingsInput {
  const data = settingsSchema.parse(input);
  const database = openDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const now = new Date().toISOString();
    const profileResult = database.prepare(`
      UPDATE "UserProfile" SET
        "openingBalanceCents" = ?, "balanceAsOf" = ?, "expectedMonthlyIncomeCents" = ?,
        "fixedMonthlyExpenseCents" = ?, "emergencyReserveCents" = ?,
        "savingsTargetCents" = ?, "monthlySpendingBudgetCents" = ?, "allowanceDay" = ?, "defaultLocation" = ?, "updatedAt" = ?
      WHERE "id" = ?
    `).run(
      data.currentBalanceCents,
      now,
      data.monthlyAllowanceCents,
      data.fixedExpenseCents,
      data.requiredReserveCents,
      data.monthlySavingsTargetCents,
      data.totalBudgetCents,
      data.allowanceDay,
      data.defaultLocation,
      now,
      userId,
    );
    if (profileResult.changes !== 1) {
      throw new Error("未找到单用户配置，请先执行数据库种子命令");
    }
    database.prepare(`
      UPDATE "UserPreference" SET
        "recommendedLunchPriceCents" = ?, "maxSingleMealCents" = ?,
        "weeklySnackDrinkLimit" = ?, "weeklySnackDrinkBudgetCents" = ?,
        "shoppingReminderThresholdCents" = ?, "coolingOffHours" = ?,
        "foodLikes" = ?, "foodDislikes" = ?, "foodAllergens" = ?,
        "protectedCategories" = ?, "updatedAt" = ?
      WHERE "userId" = ?
    `).run(
      data.recommendedLunchPriceCents,
      data.lunchHardLimitCents,
      data.weeklySnackDrinkLimit,
      data.weeklySnackDrinkBudgetCents,
      data.shoppingReminderThresholdCents,
      data.coolingOffHours,
      JSON.stringify(data.foodLikes),
      JSON.stringify(data.foodDislikes),
      JSON.stringify(data.foodAllergens),
      JSON.stringify(data.protectedCategories),
      now,
      userId,
    );
    database.exec("COMMIT");
    return data;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}
