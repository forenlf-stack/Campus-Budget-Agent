import type { BudgetTransaction } from "@/lib/budget";
import type { MealCandidateRecord } from "@/server/meal-candidate-store";
import { openDatabase } from "@/server/database";
import { readSettings } from "@/server/settings-store";

interface TransactionRow {
  id: string; type: BudgetTransaction["type"]; category: BudgetTransaction["category"];
  amountCents: number; occurredAt: string; isFixedExpense: number; itemName: string; merchant: string | null;
}

export interface MealTransaction extends BudgetTransaction { itemName: string; merchant: string | null; }

export function createSkillReadStore(userId: string) {
  function readPeriodTransactions(start: Date, end: Date): BudgetTransaction[] {
    const database = openDatabase();
    try {
      const rows = database.prepare(`SELECT "id", "type", "category", "amountCents", "occurredAt", "isFixedExpense" FROM "Transaction" WHERE "userId" = ? AND "occurredAt" >= ? AND "occurredAt" < ? AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC`).all(userId, start.toISOString(), end.toISOString()) as unknown as TransactionRow[];
      return rows.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt), isFixedExpense: Boolean(row.isFixedExpense) }));
    } finally { database.close(); }
  }
  function readMealTransactions(start: Date, end: Date): MealTransaction[] { return readCategoryTransactions("MEAL", start, end); }
  function readCategoryTransactions(category: BudgetTransaction["category"], start: Date, end: Date): MealTransaction[] {
    if (!category) return [];
    const database = openDatabase();
    try {
      const rows = database.prepare(`SELECT "id", "type", "category", "amountCents", "occurredAt", "isFixedExpense", "itemName", "merchant" FROM "Transaction" WHERE "userId" = ? AND "category" = ? AND "occurredAt" >= ? AND "occurredAt" <= ? AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC, "createdAt" DESC`).all(userId, category, start.toISOString(), end.toISOString()) as unknown as TransactionRow[];
      return rows.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt), isFixedExpense: Boolean(row.isFixedExpense) }));
    } finally { database.close(); }
  }
  function readMealCandidates(filters: { mealPeriod?: string; location?: string; maximumPriceCents?: number; enabledOnly: boolean }): MealCandidateRecord[] {
    const database = openDatabase();
    try {
      const where = [`"userId" = ?`];
      const parameters: Array<string | number> = [userId];
      if (filters.mealPeriod) { where.push(`("mealPeriod" = ? OR "mealPeriod" = 'ALL_DAY')`); parameters.push(filters.mealPeriod); }
      if (filters.location) { where.push(`"location" = ?`); parameters.push(filters.location); }
      if (filters.maximumPriceCents !== undefined) { where.push(`"typicalPriceCents" <= ?`); parameters.push(filters.maximumPriceCents); }
      if (filters.enabledOnly) where.push(`"enabled" = 1`);
      const rows = database.prepare(`SELECT * FROM "MealCandidate" WHERE ${where.join(" AND ")} ORDER BY "typicalPriceCents" ASC, "name" ASC`).all(...parameters) as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags as string), ingredients: JSON.parse(row.ingredients as string), isSpicy: Boolean(row.isSpicy), enabled: Boolean(row.enabled) } as MealCandidateRecord));
    } finally { database.close(); }
  }
  return {
    readSettings: (period?: string) => readSettings(userId, period),
    readPeriodTransactions, readMealTransactions, readCategoryTransactions, readMealCandidates,
  };
}

// Kept only for isolated unit-test defaults; request handlers always bind a verified user explicitly.
export const skillReadStore = createSkillReadStore("user_demo_001");
type BoundSkillReadStore = ReturnType<typeof createSkillReadStore>;
export type SkillReadStore = Omit<BoundSkillReadStore, "readCategoryTransactions"> & {
  readCategoryTransactions?: BoundSkillReadStore["readCategoryTransactions"];
};
