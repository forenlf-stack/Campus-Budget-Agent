import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { recordSnackPurchase } from "@/server/snack-decision-store";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE "Transaction" ("id" TEXT PRIMARY KEY, "userId" TEXT, "type" TEXT, "category" TEXT, "source" TEXT, "amountCents" INTEGER, "occurredAt" TEXT, "itemName" TEXT, "merchant" TEXT, "note" TEXT, "isFixedExpense" INTEGER, "originalTransactionId" TEXT, "createdAt" TEXT, "updatedAt" TEXT);
    CREATE TABLE "DecisionRecord" ("id" TEXT PRIMARY KEY, "userId" TEXT, "idempotencyKey" TEXT, "recommendationRunId" TEXT, "candidateId" TEXT, "itemName" TEXT, "source" TEXT, "outcome" TEXT, "recommendationType" TEXT, "recommendationRisk" TEXT, "recommendedPriceCents" INTEGER, "actualPriceCents" INTEGER, "occurredAt" TEXT, "transactionId" TEXT, "remainingBudgetAfterCents" INTEGER, "mealRemainingAfterCents" INTEGER, "recommendedDailyBudgetAfterCents" INTEGER, "savingsTargetStillOnTrack" INTEGER, "createdAt" TEXT, "updatedAt" TEXT, UNIQUE("userId", "idempotencyKey"));
  `);
  return db;
}

const input = { idempotencyKey: "550e8400-e29b-41d4-a716-446655440000", itemName: "奶茶", priceCents: 1600, merchant: "校园店", occurredAt: "2026-07-19T10:00:00.000Z", level: "YELLOW", recommendation: "SWITCH_OR_REDUCE", decisionTitle: "建议少买一点" } as const;

describe("snack decision store", () => {
  it("原子记录当前用户的 Agent 交易与决策并支持幂等", () => {
    const db = database();
    let id = 0;
    const dependencies = { openDatabase: () => db, closeDatabase: () => {}, createId: () => `id-${++id}`, now: () => new Date("2026-07-19T10:00:00.000Z"), financialContext: () => ({ remainingBudgetCents: 10000, remainingDays: 10, mealRemainingCents: 5000 }) as never };
    const first = recordSnackPurchase("user-a", input, dependencies);
    const repeated = recordSnackPurchase("user-a", input, dependencies);
    expect(first).toMatchObject({ idempotent: false, budgetAfter: { remainingBudgetCents: 8400, recommendedDailyBudgetCents: 840 } });
    expect(repeated).toMatchObject({ idempotent: true, transactionId: first.transactionId });
    expect(db.prepare(`SELECT "userId", "source", "category" FROM "Transaction"`).get()).toEqual({ userId: "user-a", source: "AGENT", category: "SNACK_DRINK" });
    expect(db.prepare(`SELECT "userId", "source" FROM "DecisionRecord"`).get()).toEqual({ userId: "user-a", source: "SNACK" });
  });
});
