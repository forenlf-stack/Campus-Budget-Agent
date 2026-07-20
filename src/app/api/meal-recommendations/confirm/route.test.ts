import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/skills/confirm-meal-purchase", () => ({ confirmMealPurchase: vi.fn() }));

import { confirmMealPurchase } from "@/server/skills/confirm-meal-purchase";
import { POST } from "./route";

const mockedConfirm = vi.mocked(confirmMealPurchase);
const input = {
  idempotencyKey: "4bc67e55-2264-4c1f-ab24-65df42dd19c2", recommendationRunId: "run-1", candidateId: "meal-1",
  itemName: "鸡腿饭", source: "HISTORY", recommendationType: "OVERALL", recommendationRisk: "暂无明显风险",
  recommendedPriceCents: 1_500, actualPriceCents: 1_600, occurredAt: "2026-07-16T12:00:00.000Z",
};

function request(body: unknown) {
  return new Request("http://localhost/api/meal-recommendations/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function result(idempotent: boolean) {
  return { success: true as const, data: {
    decisionId: "decision-1", transactionId: "transaction-1", idempotent,
    budgetImpact: { remainingBudgetAfterCents: 108_400, mealRemainingAfterCents: 53_400, recommendedDailyBudgetAfterCents: 6_775, savingsTargetStillOnTrack: true },
    budgetAfter: { remainingBudgetCents: 108_400, mealRemainingCents: 53_400, recommendedDailyBudgetCents: 6_775 },
  } };
}

describe("POST /api/meal-recommendations/confirm", () => {
  beforeEach(() => mockedConfirm.mockReset());

  it("首次确认返回201", async () => {
    mockedConfirm.mockReturnValueOnce(result(false));
    const response = await POST(request(input) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ transactionId: "transaction-1", idempotent: false });
  });

  it("幂等重试返回200", async () => {
    mockedConfirm.mockReturnValueOnce(result(true));
    const response = await POST(request(input) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(200);
  });

  it("非法输入不会调用写入Skill", async () => {
    const response = await POST(request({ ...input, actualPriceCents: 0 }) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(400);
    expect(mockedConfirm).not.toHaveBeenCalled();
  });
});
