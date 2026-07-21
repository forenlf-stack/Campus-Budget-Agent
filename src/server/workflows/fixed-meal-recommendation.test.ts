import { describe, expect, it } from "vitest";

import { type BudgetTransaction } from "@/lib/budget";
import type { SettingsInput } from "@/lib/settings";
import type { MealCandidateRecord } from "@/server/meal-candidate-store";
import type { MealTransaction, SkillReadStore } from "@/server/skill-read-store";
import { runFixedMealRecommendation, shanghaiMealPeriod } from "./fixed-meal-recommendation";

const date = new Date("2026-07-14T12:00:00+08:00");
const settings: SettingsInput = {
  period: "2026-07", monthlyAllowanceCents: 220_000, currentBalanceCents: 350_000, fixedExpenseCents: 60_000,
  monthlySavingsTargetCents: 40_000, requiredReserveCents: 10_000, allowanceDay: 1, defaultLocation: "东校区",
    totalBudgetCents: 110_000,
  recommendedLunchPriceCents: 1_500, lunchHardLimitCents: 2_500, weeklySnackDrinkLimit: 2,
  weeklySnackDrinkBudgetCents: 2_000, shoppingReminderThresholdCents: 5_000, coolingOffHours: 24,
  foodLikes: ["米饭"], foodDislikes: ["香菜"], foodAllergens: ["花生"], protectedCategories: [],
};
const transactions: BudgetTransaction[] = [{ id: "spent", type: "EXPENSE", category: "MEAL", amountCents: 2_000, occurredAt: new Date("2026-07-10T12:00:00+08:00"), isFixedExpense: false }];
const recentMeals: MealTransaction[] = [{ ...transactions[0], id: "recent", itemName: "鸡腿饭", merchant: "第一食堂" }];

function candidate(id: string, overrides: Partial<MealCandidateRecord> = {}): MealCandidateRecord {
  return { id, name: `餐食${id}`, merchant: "第一食堂", typicalPriceCents: 1_500, location: "东校区", mealPeriod: "LUNCH", tags: ["米饭"], ingredients: ["大米", "鸡肉"], isSpicy: false, userRating: 4, lastPurchasedAt: null, priceUpdatedAt: "2026-07-01T00:00:00.000Z", dataSource: "SEED", enabled: true, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

function store(candidates: MealCandidateRecord[] = [candidate("a")], overrides: Partial<SkillReadStore> = {}): SkillReadStore {
  return { readSettings: () => settings, readPeriodTransactions: () => transactions, readMealTransactions: () => recentMeals, readMealCandidates: () => candidates, ...overrides };
}

function run(candidates: MealCandidateRecord[] = [candidate("a")], input: Record<string, unknown> = {}, overrides: Parameters<typeof runFixedMealRecommendation>[1] = {}) {
  return runFixedMealRecommendation({ date, ...input }, { store: store(candidates), createRunId: () => "run-fixed-001", ...overrides });
}

describe("fixed meal recommendation workflow", () => {
  it("按上海时间自动判定早餐、午餐和晚餐边界", () => {
    expect(shanghaiMealPeriod(new Date("2026-07-14T05:00:00+08:00"))).toBe("BREAKFAST");
    expect(shanghaiMealPeriod(new Date("2026-07-14T10:29:00+08:00"))).toBe("BREAKFAST");
    expect(shanghaiMealPeriod(new Date("2026-07-14T10:30:00+08:00"))).toBe("LUNCH");
    expect(shanghaiMealPeriod(new Date("2026-07-14T16:29:00+08:00"))).toBe("LUNCH");
    expect(shanghaiMealPeriod(new Date("2026-07-14T16:30:00+08:00"))).toBe("DINNER");
  });

  it("默认无输入并按固定顺序执行五个Skill", () => {
    const result = runFixedMealRecommendation({}, { store: store(), now: () => date, createRunId: () => "run" });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.status).toBe("READY");
    expect(result.data.location).toBe("东校区");
    expect(result.data.executionSteps.map((step) => step.step)).toEqual(["get_financial_context", "get_recent_meal_consumption", "retrieve_history_meals", "rank_meal_candidates", "simulate_budget_impact"]);
  });

  it("默认最多返回6条不同候选并优先覆盖推荐方向", () => {
    const result = run([candidate("a"), candidate("b"), candidate("c"), candidate("d"), candidate("e")]);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.recommendations).toHaveLength(5);
    expect(new Set(result.data.recommendations.map((item) => item.candidate.id)).size).toBe(5);
    expect(result.data.recommendations.slice(0, 4).map((item) => item.ranking.recommendationType)).toEqual(["OVERALL", "SAVE_MONEY", "TASTE", "NEW_OR_CONVENIENT"]);
  });

  it("严格忌口候选被排除", () => {
    const result = run([candidate("unsafe", { ingredients: ["花生"] }), candidate("safe")]);
    expect(result.success && result.data.recommendations.map((item) => item.candidate.id)).not.toContain("unsafe");
  });

  it("超过设置参考价仍保留并明确提示风险", () => {
    const result = run([candidate("costly", { typicalPriceCents: 2_501 })]);
    expect(result).toMatchObject({ success: true, data: { status: "READY", recommendations: [{ ranking: { risks: expect.arrayContaining(["ABOVE_PREFERRED_PRICE_RANGE"]) } }] } });
  });

  it("用户明确价格上限时仍严格过滤", () => {
    const result = run([candidate("costly", { typicalPriceCents: 2_501 })], { userRequest: "最多25元" });
    expect(result).toMatchObject({ success: true, data: { status: "NO_RECOMMENDATIONS", recommendations: [] } });
  });

  it("换批优先排除上一批候选", () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c"), candidate("d"), candidate("e"), candidate("f"), candidate("g"), candidate("h")];
    const first = run(candidates);
    if (!first.success) throw new Error(first.error.message);
    const excluded = first.data.recommendations.map((item) => item.candidate.id);
    const second = run(candidates, { excludeCandidateIds: excluded });
    if (!second.success) throw new Error(second.error.message);
    expect(second.data.recommendations.map((item) => item.candidate.id)).toEqual(["g", "h"]);
  });

  it("全部排除时轮转回退且不原样重复整批", () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const result = run(candidates, { excludeCandidateIds: ["a", "b", "c"] });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.recommendations.map((item) => item.candidate.id)).not.toEqual(["a", "b", "c"]);
  });

  it("默认使用地点做便利评分，但不限制历史候选检索", () => {
    let filters: unknown;
    const result = runFixedMealRecommendation({ date }, { store: store([candidate("near"), candidate("far", { location: "西校区" })], { readMealCandidates: (received) => { filters = received; return [candidate("near"), candidate("far", { location: "西校区" })]; } }), createRunId: () => "run" });
    expect(filters).toEqual({ enabledOnly: true });
    expect(result.success && result.data.recommendations.map((item) => item.candidate.id)).toContain("far");
  });

  it("STAY_NEAR作为排序偏好而不在检索阶段删除远处候选", () => {
    let filters: unknown;
    runFixedMealRecommendation({ date, quickTags: ["STAY_NEAR"] }, { store: store([], { readMealCandidates: (received) => { filters = received; return []; } }), createRunId: () => "run" });
    expect(filters).toEqual({ enabledOnly: true });
  });

  it("非法公开输入返回INVALID_INPUT", () => {
    expect(runFixedMealRecommendation({ mealPeriod: "LUNCH" }, { createRunId: () => "run" })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });

  it("最终预算模拟未超支时移除排序阶段的过期超支风险", () => {
    const result = run([candidate("safe")], {}, {
      rankMealCandidates: () => ({ success: true, data: { status: "READY", filtered: [], recommendations: [{
        candidateId: "safe", totalScore: 8_000, scoreBreakdown: { budgetFit: 3_500, preferenceMatch: 1_500, recentVariety: 1_500, historicalRating: 1_000, locationConvenience: 500 },
        estimatedPriceCents: 1_500, recommendationLevel: "STRONG", recommendationType: "OVERALL", reasons: [],
        risks: ["WILL_EXCEED_TOTAL_BUDGET"], dataSource: "SEED", priceUpdatedAt: "2026-07-01T00:00:00.000Z",
      }] } }),
      simulateBudgetImpact: () => ({ success: true, data: {
        remainingBudgetAfterCents: 50_000, mealRemainingAfterCents: 20_000, exceedsRecommendedPrice: false,
        exceedsHardLimit: false, causesMealBudgetOverrun: false, recommendedDailyBudgetAfterCents: 3_000,
        recommendedDailyBudgetAfterStatus: "AVAILABLE", savingsTargetStillOnTrack: true,
      } }),
    });
    expect(result.success && result.data.recommendations[0].ranking.risks).not.toContain("WILL_EXCEED_TOTAL_BUDGET");
  });
});
