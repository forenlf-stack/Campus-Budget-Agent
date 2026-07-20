import { randomUUID } from "node:crypto";

import type { ConfirmSnackPurchaseInput } from "@/lib/snack-decisions";
import { openDatabase } from "@/server/database";
import { createSkillReadStore } from "@/server/skill-read-store";
import { getFinancialContext, type FinancialContextData } from "@/server/skills/get-financial-context";

interface ExistingDecision { id: string; transactionId: string; actualPriceCents: number; itemName: string; remainingBudgetAfterCents: number; recommendedDailyBudgetAfterCents: number; }

interface SnackDecisionStoreDependencies {
  openDatabase: typeof openDatabase;
  closeDatabase: (database: ReturnType<typeof openDatabase>) => void;
  createId: () => string;
  now: () => Date;
  financialContext: (userId: string, occurredAt: Date) => FinancialContextData;
}

const defaultDependencies: SnackDecisionStoreDependencies = {
  openDatabase,
  closeDatabase: (database) => database.close(),
  createId: randomUUID,
  now: () => new Date(),
  financialContext: (userId, occurredAt) => {
    const result = getFinancialContext({ queryDate: occurredAt }, createSkillReadStore(userId));
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  },
};

export function recordSnackPurchase(userId: string, input: ConfirmSnackPurchaseInput, overrides: Partial<SnackDecisionStoreDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const occurredAt = new Date(input.occurredAt);
  const financial = dependencies.financialContext(userId, occurredAt);
  const remainingBudgetAfterCents = financial.remainingBudgetCents - input.priceCents;
  const recommendedDailyBudgetAfterCents = financial.remainingDays > 0 ? Math.max(Math.floor(remainingBudgetAfterCents / financial.remainingDays), 0) : 0;
  const database = dependencies.openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const existing = database.prepare(`SELECT "id", "transactionId", "actualPriceCents", "itemName", "remainingBudgetAfterCents", "recommendedDailyBudgetAfterCents" FROM "DecisionRecord" WHERE "userId" = ? AND "idempotencyKey" = ?`)
      .get(userId, input.idempotencyKey) as ExistingDecision | undefined;
    if (existing) {
      if (existing.itemName !== input.itemName || existing.actualPriceCents !== input.priceCents) throw new Error("幂等键已用于不同的零食确认请求");
      database.exec("COMMIT");
      return { decisionId: existing.id, transactionId: existing.transactionId, idempotent: true, budgetAfter: { remainingBudgetCents: existing.remainingBudgetAfterCents, recommendedDailyBudgetCents: existing.recommendedDailyBudgetAfterCents } };
    }
    const decisionId = dependencies.createId();
    const transactionId = dependencies.createId();
    const now = dependencies.now().toISOString();
    database.prepare(`INSERT INTO "Transaction" ("id", "userId", "type", "category", "source", "amountCents", "occurredAt", "itemName", "merchant", "note", "isFixedExpense", "originalTransactionId", "createdAt", "updatedAt") VALUES (?, ?, 'EXPENSE', 'SNACK_DRINK', 'AGENT', ?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
      .run(transactionId, userId, input.priceCents, input.occurredAt, input.itemName, input.merchant || null, `购买前判断：${input.decisionTitle}`, now, now);
    database.prepare(`INSERT INTO "DecisionRecord" ("id", "userId", "idempotencyKey", "recommendationRunId", "candidateId", "itemName", "source", "outcome", "recommendationType", "recommendationRisk", "recommendedPriceCents", "actualPriceCents", "occurredAt", "transactionId", "remainingBudgetAfterCents", "mealRemainingAfterCents", "recommendedDailyBudgetAfterCents", "savingsTargetStillOnTrack", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, 'SNACK', 'PURCHASED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(decisionId, userId, input.idempotencyKey, `snack-${input.idempotencyKey}`, `snack:${input.itemName}`, input.itemName, input.recommendation, input.level, input.priceCents, input.priceCents, input.occurredAt, transactionId, remainingBudgetAfterCents, financial.mealRemainingCents, recommendedDailyBudgetAfterCents, remainingBudgetAfterCents >= 0 ? 1 : 0, now, now);
    database.exec("COMMIT");
    return { decisionId, transactionId, idempotent: false, budgetAfter: { remainingBudgetCents: remainingBudgetAfterCents, recommendedDailyBudgetCents: recommendedDailyBudgetAfterCents } };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  } finally { dependencies.closeDatabase(database); }
}
