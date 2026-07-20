import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { ConfirmMealDecisionInput } from "@/lib/meal-decisions";
import { recordPurchasedMealDecision } from "./meal-decision-store";

const input: ConfirmMealDecisionInput = {
  idempotencyKey: "4bc67e55-2264-4c1f-ab24-65df42dd19c2",
  recommendationRunId: "run-1",
  candidateId: "meal-1",
  itemName: "鸡腿饭",
  source: "HISTORY",
  recommendationType: "OVERALL",
  recommendationRisk: "暂无明显风险",
  recommendedPriceCents: 1_500,
  actualPriceCents: 1_600,
  occurredAt: "2026-07-16T12:00:00.000Z",
};

const impact = {
  remainingBudgetAfterCents: 108_400,
  mealRemainingAfterCents: 53_400,
  recommendedDailyBudgetAfterCents: 6_775,
  recommendedDailyBudgetAfterStatus: "AVAILABLE" as const,
  savingsTargetStillOnTrack: true,
  exceedsRecommendedPrice: true,
  exceedsHardLimit: false,
  causesMealBudgetOverrun: false,
};

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "UserProfile" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Transaction" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "category" TEXT,
      "source" TEXT NOT NULL, "amountCents" INTEGER NOT NULL, "occurredAt" TEXT NOT NULL,
      "itemName" TEXT NOT NULL, "merchant" TEXT, "note" TEXT, "isFixedExpense" INTEGER NOT NULL,
      "originalTransactionId" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "UserProfile"("id")
    );
    CREATE TABLE "DecisionRecord" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
      "recommendationRunId" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "itemName" TEXT NOT NULL,
      "source" TEXT NOT NULL, "outcome" TEXT NOT NULL, "recommendationType" TEXT NOT NULL,
      "recommendationRisk" TEXT NOT NULL, "recommendedPriceCents" INTEGER NOT NULL,
      "actualPriceCents" INTEGER, "occurredAt" TEXT, "transactionId" TEXT UNIQUE,
      "remainingBudgetAfterCents" INTEGER, "mealRemainingAfterCents" INTEGER,
      "recommendedDailyBudgetAfterCents" INTEGER, "savingsTargetStillOnTrack" INTEGER,
      "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL,
      UNIQUE ("userId", "idempotencyKey"),
      FOREIGN KEY ("userId") REFERENCES "UserProfile"("id"),
      FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    );
    INSERT INTO "UserProfile" ("id") VALUES ('user_demo_001');
  `);
  return db;
}

describe("餐食决策事务存储", () => {
  it("原子创建决策和AGENT交易", () => {
    const db = database();
    const ids = ["decision-1", "transaction-1"];
    const result = recordPurchasedMealDecision("user_demo_001", input, impact, {
      openDatabase: () => db,
      closeDatabase: () => undefined,
      createId: () => ids.shift() ?? "unexpected",
      now: () => new Date("2026-07-16T12:01:00.000Z"),
    });
    expect(result).toMatchObject({ decisionId: "decision-1", transactionId: "transaction-1", idempotent: false });
    expect(db.prepare(`SELECT "source", "amountCents" FROM "Transaction"`).get()).toEqual({ source: "AGENT", amountCents: 1_600 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "DecisionRecord"`).get()).toEqual({ count: 1 });
  });

  it("相同请求重复提交不生成第二笔交易", () => {
    const db = database();
    const ids = ["decision-1", "transaction-1"];
    const dependencies = { openDatabase: () => db, closeDatabase: () => undefined, createId: () => ids.shift() ?? "unexpected", now: () => new Date("2026-07-16T12:01:00.000Z") };
    recordPurchasedMealDecision("user_demo_001", input, impact, dependencies);
    const repeated = recordPurchasedMealDecision("user_demo_001", input, impact, dependencies);
    expect(repeated.idempotent).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "Transaction"`).get()).toEqual({ count: 1 });
  });

  it("相同幂等键用于不同金额时拒绝且不新增交易", () => {
    const db = database();
    const ids = ["decision-1", "transaction-1"];
    const dependencies = { openDatabase: () => db, closeDatabase: () => undefined, createId: () => ids.shift() ?? "unexpected", now: () => new Date("2026-07-16T12:01:00.000Z") };
    recordPurchasedMealDecision("user_demo_001", input, impact, dependencies);
    expect(() => recordPurchasedMealDecision("user_demo_001", { ...input, actualPriceCents: 1_800 }, impact, dependencies)).toThrow("幂等键已用于不同的餐食确认请求");
    expect(db.prepare(`SELECT COUNT(*) AS count FROM "Transaction"`).get()).toEqual({ count: 1 });
  });
});
