import { describe, expect, it, vi } from "vitest";

import { directMealRecommendationResponseSchema } from "@/lib/meal-recommendations";

vi.mock("@/server/workflows/fixed-meal-recommendation", () => ({
  runFixedMealRecommendation: vi.fn(() => ({
    success: true,
    data: {
      runId: "api-run", status: "READY", mealPeriod: "LUNCH", location: "东校区",
      financialSummary: {}, recentMealSummary: {}, executionSteps: [],
      recommendations: [{
        candidate: { id: "meal-1", name: "鸡腿饭", merchant: "第一食堂一楼", location: "东校区", tags: ["米饭套餐"], typicalPriceCents: 1_500 },
        ranking: { recommendationType: "OVERALL", reasons: ["WITHIN_RECOMMENDED_PRICE"], risks: [], totalScore: 8_000, scoreBreakdown: { budgetFit: 3_500, preferenceMatch: 2_000, recentVariety: 1_500, historicalRating: 500, locationConvenience: 500 } },
        budgetImpact: { remainingBudgetAfterCents: 10_000, mealRemainingAfterCents: 5_000, recommendedDailyBudgetAfterCents: 1_000, savingsTargetStillOnTrack: true },
      }],
    },
  })),
}));

import { runFixedMealRecommendation } from "@/server/workflows/fixed-meal-recommendation";
import { conversationalizeAgentText, POST } from "./route";

describe("POST /api/meal-recommendations/direct", () => {
  it.each([
    ["用户想尝试日料", "你想尝试日料"],
    ["用户需要一顿清淡午餐", "你希望一顿清淡午餐"],
    ["用户希望控制价格", "你希望控制价格"],
  ])("把模型的后台描述转换为对话口吻：%s", (input, expected) => {
    expect(conversationalizeAgentText(input)).toBe(expected);
  });

  it("接受空对象并返回推荐卡与durationMs", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(runFixedMealRecommendation).toHaveBeenCalledWith({ quickTags: [], excludeCandidateIds: [], userRequest: "", maxRecommendations: 6, interpretedRequest: null }, expect.objectContaining({ store: expect.any(Object) }));
    expect(payload).toMatchObject({ status: "READY", agentResponse: null, recommendations: [{ name: "鸡腿饭", merchant: "第一食堂一楼", acquisitionLabel: "东校区", priceCents: 1_500, actionLabel: "选这个", shortTags: ["价格合适"], risk: "暂无明显风险" }] });
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(directMealRecommendationResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("接受空请求体", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/direct", { method: "POST" });
    const response = await POST(request as Parameters<typeof POST>[0]);
    expect(response.status).toBe(200);
  });

  it("拒绝非法快捷标签", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quickTags: ["UNKNOWN"] }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("候选库没有用户想吃的具体餐食时明确标注备选而不谎称命中", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userRequest: "25元以内想吃咖喱，推荐", skipAgentInterpretation: true }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.agentResponse.response).toContain("没有包含“咖喱”的选项");
    expect(payload.agentResponse.response).toContain("并非该类餐食");
  });
});
