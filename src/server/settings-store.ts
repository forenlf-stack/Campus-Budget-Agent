import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { transactionCategories } from "@/lib/budget";
import { settingsSchema, type SettingsInput } from "@/lib/settings";

const userId = "user_demo_001";

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

function periodToDate(period: string): string {
  return `${period}-01T00:00:00.000Z`;
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

export function readSettings(period = getCurrentPeriod()): SettingsInput {
  const database = openDatabase();
  try {
    const profile = database.prepare(`
      SELECT "openingBalanceCents", "expectedMonthlyIncomeCents", "fixedMonthlyExpenseCents",
             "emergencyReserveCents", "savingsTargetCents", "allowanceDay", "defaultLocation"
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
    const rows = database.prepare(`
      SELECT "category", "amountCents" FROM "CategoryBudget"
      WHERE "userId" = ? AND "periodStart" = ?
    `).all(userId, periodToDate(period)) as Array<{ category: string; amountCents: number }>;
    const budgetMap = new Map(rows.map((row) => [row.category, row.amountCents]));
    return settingsSchema.parse({
      period,
      monthlyAllowanceCents: profile.expectedMonthlyIncomeCents,
      currentBalanceCents: profile.openingBalanceCents,
      fixedExpenseCents: profile.fixedMonthlyExpenseCents,
      monthlySavingsTargetCents: profile.savingsTargetCents,
      requiredReserveCents: profile.emergencyReserveCents,
      allowanceDay: profile.allowanceDay,
      defaultLocation: profile.defaultLocation,
      categoryBudgets: transactionCategories.map((category) => ({ category, budgetCents: budgetMap.get(category) ?? 0 })),
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

export function saveSettings(input: SettingsInput): SettingsInput {
  const data = settingsSchema.parse(input);
  const database = openDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const now = new Date().toISOString();
    const profileResult = database.prepare(`
      UPDATE "UserProfile" SET
        "openingBalanceCents" = ?, "expectedMonthlyIncomeCents" = ?,
        "fixedMonthlyExpenseCents" = ?, "emergencyReserveCents" = ?,
        "savingsTargetCents" = ?, "allowanceDay" = ?, "defaultLocation" = ?, "updatedAt" = ?
      WHERE "id" = ?
    `).run(
      data.currentBalanceCents,
      data.monthlyAllowanceCents,
      data.fixedExpenseCents,
      data.requiredReserveCents,
      data.monthlySavingsTargetCents,
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
    const statement = database.prepare(`
      INSERT INTO "CategoryBudget" ("id", "userId", "category", "periodStart", "amountCents", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT ("userId", "category", "periodStart") DO UPDATE SET
        "amountCents" = excluded."amountCents", "updatedAt" = excluded."updatedAt"
    `);
    for (const budget of data.categoryBudgets) {
      statement.run(`budget_${data.period.replace("-", "_")}_${budget.category.toLowerCase()}`, userId, budget.category, periodToDate(data.period), budget.budgetCents, now, now);
    }
    database.exec("COMMIT");
    return data;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}
