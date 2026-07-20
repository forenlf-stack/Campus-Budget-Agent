import { randomUUID } from "node:crypto";

import type { ConfirmMealDecisionInput, ConfirmMealDecisionResponse } from "@/lib/meal-decisions";
import { openDatabase } from "@/server/database";
import type { BudgetImpactData } from "@/server/skills/simulate-budget-impact";

interface DecisionRow {
  id: string;
  transactionId: string;
  recommendationRunId: string;
  candidateId: string;
  itemName: string;
  source: ConfirmMealDecisionInput["source"];
  recommendationType: ConfirmMealDecisionInput["recommendationType"];
  recommendationRisk: string;
  recommendedPriceCents: number;
  actualPriceCents: number;
  occurredAt: string;
  remainingBudgetAfterCents: number;
  mealRemainingAfterCents: number;
  recommendedDailyBudgetAfterCents: number;
  savingsTargetStillOnTrack: number;
}

export interface MealDecisionStoreDependencies {
  openDatabase: typeof openDatabase;
  closeDatabase: (database: ReturnType<typeof openDatabase>) => void;
  createId: () => string;
  now: () => Date;
}

const defaultDependencies: MealDecisionStoreDependencies = {
  openDatabase,
  closeDatabase: (database) => database.close(),
  createId: randomUUID,
  now: () => new Date(),
};

export interface RecordedMealDecision {
  decisionId: string;
  transactionId: string;
  idempotent: boolean;
  budgetImpact: ConfirmMealDecisionResponse["budgetImpact"];
}

function toRecorded(row: DecisionRow, idempotent: boolean): RecordedMealDecision {
  return {
    decisionId: row.id,
    transactionId: row.transactionId,
    idempotent,
    budgetImpact: {
      remainingBudgetAfterCents: row.remainingBudgetAfterCents,
      mealRemainingAfterCents: row.mealRemainingAfterCents,
      recommendedDailyBudgetAfterCents: row.recommendedDailyBudgetAfterCents,
      savingsTargetStillOnTrack: Boolean(row.savingsTargetStillOnTrack),
    },
  };
}

export function recordPurchasedMealDecision(
  userId: string,
  input: ConfirmMealDecisionInput,
  budgetImpact: BudgetImpactData,
  dependencyOverrides: Partial<MealDecisionStoreDependencies> = {},
): RecordedMealDecision {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const database = dependencies.openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const existing = database.prepare(`
      SELECT "id", "transactionId", "recommendationRunId", "candidateId", "itemName", "source",
             "recommendationType", "recommendationRisk", "recommendedPriceCents", "actualPriceCents", "occurredAt",
             "remainingBudgetAfterCents", "mealRemainingAfterCents",
             "recommendedDailyBudgetAfterCents", "savingsTargetStillOnTrack"
      FROM "DecisionRecord" WHERE "userId" = ? AND "idempotencyKey" = ?
    `).get(userId, input.idempotencyKey) as DecisionRow | undefined;
    if (existing) {
      const sameRequest = existing.recommendationRunId === input.recommendationRunId
        && existing.candidateId === input.candidateId
        && existing.itemName === input.itemName
        && existing.source === input.source
        && existing.recommendationType === input.recommendationType
        && existing.recommendationRisk === input.recommendationRisk
        && existing.recommendedPriceCents === input.recommendedPriceCents
        && existing.actualPriceCents === input.actualPriceCents
        && new Date(existing.occurredAt).toISOString() === new Date(input.occurredAt).toISOString();
      if (!sameRequest) throw new Error("幂等键已用于不同的餐食确认请求");
      database.exec("COMMIT");
      return toRecorded(existing, true);
    }

    const now = dependencies.now().toISOString();
    const decisionId = dependencies.createId();
    const transactionId = dependencies.createId();
    database.prepare(`
      INSERT INTO "Transaction" (
        "id", "userId", "type", "category", "source", "amountCents", "occurredAt",
        "itemName", "merchant", "note", "isFixedExpense", "originalTransactionId", "createdAt", "updatedAt"
      ) VALUES (?, ?, 'EXPENSE', 'MEAL', 'AGENT', ?, ?, ?, NULL, ?, 0, NULL, ?, ?)
    `).run(
      transactionId,
      userId,
      input.actualPriceCents,
      input.occurredAt,
      input.itemName,
      `推荐运行 ${input.recommendationRunId}，候选 ${input.candidateId}`,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO "DecisionRecord" (
        "id", "userId", "idempotencyKey", "recommendationRunId", "candidateId", "itemName",
        "source", "outcome", "recommendationType", "recommendationRisk", "recommendedPriceCents",
        "actualPriceCents", "occurredAt", "transactionId", "remainingBudgetAfterCents",
        "mealRemainingAfterCents", "recommendedDailyBudgetAfterCents", "savingsTargetStillOnTrack",
        "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PURCHASED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decisionId,
      userId,
      input.idempotencyKey,
      input.recommendationRunId,
      input.candidateId,
      input.itemName,
      input.source,
      input.recommendationType,
      input.recommendationRisk,
      input.recommendedPriceCents,
      input.actualPriceCents,
      input.occurredAt,
      transactionId,
      budgetImpact.remainingBudgetAfterCents,
      budgetImpact.mealRemainingAfterCents,
      budgetImpact.recommendedDailyBudgetAfterCents,
      budgetImpact.savingsTargetStillOnTrack ? 1 : 0,
      now,
      now,
    );
    database.exec("COMMIT");
    return {
      decisionId,
      transactionId,
      idempotent: false,
      budgetImpact: {
        remainingBudgetAfterCents: budgetImpact.remainingBudgetAfterCents,
        mealRemainingAfterCents: budgetImpact.mealRemainingAfterCents,
        recommendedDailyBudgetAfterCents: budgetImpact.recommendedDailyBudgetAfterCents,
        savingsTargetStillOnTrack: budgetImpact.savingsTargetStillOnTrack,
      },
    };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  } finally {
    dependencies.closeDatabase(database);
  }
}
