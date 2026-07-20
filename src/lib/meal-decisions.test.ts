import { describe, expect, it } from "vitest";

import { confirmMealDecisionInputSchema } from "./meal-decisions";

const valid = {
  idempotencyKey: "4bc67e55-2264-4c1f-ab24-65df42dd19c2",
  recommendationRunId: "run-1",
  candidateId: "meal-1",
  itemName: "鸡腿饭",
  source: "HISTORY" as const,
  recommendationType: "OVERALL" as const,
  recommendationRisk: "暂无明显风险",
  recommendedPriceCents: 1_500,
  actualPriceCents: 1_600,
  occurredAt: "2026-07-16T12:00:00.000Z",
};

describe("餐食购买确认契约", () => {
  it("接受完整的最终确认", () => {
    expect(confirmMealDecisionInputSchema.parse(valid)).toEqual(valid);
  });

  it("拒绝无效幂等键、金额和日期", () => {
    expect(confirmMealDecisionInputSchema.safeParse({ ...valid, idempotencyKey: "retry" }).success).toBe(false);
    expect(confirmMealDecisionInputSchema.safeParse({ ...valid, actualPriceCents: 0 }).success).toBe(false);
    expect(confirmMealDecisionInputSchema.safeParse({ ...valid, occurredAt: "today" }).success).toBe(false);
  });

  it("拒绝客户端夹带额外字段", () => {
    expect(confirmMealDecisionInputSchema.safeParse({ ...valid, source: "HISTORY", sourceCode: "forged" }).success).toBe(false);
  });
});
