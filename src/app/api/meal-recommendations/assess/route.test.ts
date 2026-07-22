import { describe, expect, it, vi } from "vitest";

const { callDeepSeekJson } = vi.hoisted(() => ({ callDeepSeekJson: vi.fn() }));

vi.mock("@/server/llm/deepseek-client", () => ({ callDeepSeekJson }));

vi.mock("@/server/skill-read-store", () => ({
  createSkillReadStore: () => ({
    readSettings: () => ({
      period: "2026-07", monthlyAllowanceCents: 100_000, currentBalanceCents: 100_000,
      fixedExpenseCents: 0, monthlySavingsTargetCents: 0, requiredReserveCents: 0,
      allowanceDay: 1, defaultLocation: "", totalBudgetCents: 1_000,
      recommendedLunchPriceCents: 1_500, lunchHardLimitCents: 2_500,
      weeklySnackDrinkLimit: 2, weeklySnackDrinkBudgetCents: 2_000,
      shoppingReminderThresholdCents: 5_000, coolingOffHours: 24,
      foodLikes: [], foodDislikes: [], foodAllergens: [], protectedCategories: [],
    }),
    readPeriodTransactions: () => [],
    readMealTransactions: () => [],
    readMealCandidates: () => [],
  }),
}));

import { isMealPlanAssessmentRequest, POST } from "./route";

describe("meal plan assessment intent", () => {
  it("识别已经给出方案和总价的评价请求", () => {
    expect(isMealPlanAssessmentRequest("你认为一顿麻辣烫怎么样？加了火锅食材和蔬菜豆制品，总共31元")).toBe(true);
  });

  it("普通推荐请求不进入方案评价", () => {
    expect(isMealPlanAssessmentRequest("我想吃麻辣烫，帮我推荐一下")).toBe(false);
  });

  it("识别中文金额的临时餐食评价", () => {
    expect(isMealPlanAssessmentRequest("吃二十元的麦当劳你觉得可以吗")).toBe(true);
  });

  it("预算会变为负数时返回带符号金额而不是500", async () => {
    callDeepSeekJson.mockRejectedValueOnce(new Error("skip model"));
    const request = new Request("http://localhost/api/meal-recommendations/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "这顿30元合适吗" }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "RULES", remainingBudgetAfterCents: -2_000 });
    expect(payload.reasons).toContain("购买后本月预算预计剩余 ¥-20.00");
  });

  it("模型臆测食材或营养时拒绝采用并回退本地事实", async () => {
    callDeepSeekJson.mockImplementationOnce(async (_system, _input, schema) => schema.parse({ reply: "这顿蔬菜较少，建议补充蛋白质。" }));
    const request = new Request("http://localhost/api/meal-recommendations/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "这顿10元合适吗" }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.source).toBe("RULES");
    expect(payload.reply).toContain("近14天");
    expect(payload.reply).not.toMatch(/蔬菜|蛋白质/);
  });

  it.each([
    ["￥30的鳗鱼牛肉饭合适吗", 3_000],
    ["31块5的咖喱饭值不值", 3_150],
  ])("评价接口与前端共用金额解析：%s", async (description, expectedPriceCents) => {
    callDeepSeekJson.mockRejectedValueOnce(new Error("skip model"));
    const response = await POST(new Request("http://localhost/api/meal-recommendations/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.priceCents).toBe(expectedPriceCents);
  });
});
