import { describe, expect, it } from "vitest";

import { rankMealCandidates } from "./rank-meal-candidates";
import { simulateBudgetImpact } from "./simulate-budget-impact";

const financialContext = {
  budgetPeriod: "2026-07", flexibleBudgetCents: 110_000, actualNetSpendingCents: 20_000, remainingBudgetCents: 90_000,
  mealBudgetCents: 55_000, mealUsedCents: 20_000, mealRemainingCents: 35_000, remainingDays: 10,
  recommendedDailyBudgetCents: 9_000, recommendedDailyBudgetStatus: "AVAILABLE" as const,
  recommendedLunchPriceCents: 1_500, lunchHardLimitCents: 2_500,
  savingsTarget: { status: "CONFIGURED" as const, targetCents: 40_000 },
};

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: `餐食${id}`, merchant: "第一食堂", typicalPriceCents: 1_500, location: "东校区", mealPeriod: "LUNCH" as const,
    tags: ["米饭"], ingredients: ["大米", "鸡肉"], isSpicy: false, userRating: 4, lastPurchasedAt: null,
    enabled: true, priceSource: "SEED" as const, priceUpdatedAt: "2026-07-01T00:00:00.000Z", ...overrides,
  };
}

function rankInput(candidates = [candidate("a")], overrides: Record<string, unknown> = {}) {
  return {
    candidates,
    financialContext,
    recentMealContext: { recentMeals: [] },
    longTermPreferences: { foodLikes: ["米饭"], foodDislikes: ["香菜"], strictAvoidances: ["花生"], defaultLocation: "东校区" },
    temporaryPreferences: { mealPeriod: "LUNCH", location: "东校区", hardPriceLimitCents: 2_500 },
    ...overrides,
  };
}

describe("rank_meal_candidates", () => {
  it("返回完整分项且总分等于分项之和", () => {
    const result = rankMealCandidates(rankInput());
    expect(result.success).toBe(true);
    if (result.success) {
      const item = result.data.recommendations[0];
      expect(item.totalScore).toBe(Object.values(item.scoreBreakdown).reduce((sum, value) => sum + value, 0));
      expect(item).toMatchObject({ estimatedPriceCents: 1_500, dataSource: "SEED", priceUpdatedAt: "2026-07-01T00:00:00.000Z" });
    }
  });

  it("接受VISION运行时价格来源并原样透传", () => {
    const result = rankMealCandidates(rankInput([candidate("vision", { priceSource: "VISION" })]));
    expect(result).toMatchObject({ success: true, data: { recommendations: [{ dataSource: "VISION" }] } });
  });

  it("禁用候选被硬过滤", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { enabled: false })]));
    expect(result.success && result.data).toMatchObject({ status: "NO_ELIGIBLE_CANDIDATES", recommendations: [], filtered: [{ candidateId: "a", reasons: ["DISABLED"] }] });
  });

  it("严格过敏或忌口冲突被硬过滤", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { ingredients: ["花生"] })]));
    expect(result.success && result.data.filtered[0].reasons).toContain("STRICT_AVOIDANCE_CONFLICT");
  });

  it("严格忌口支持包含关系匹配", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { tags: ["花生碎配料"] })]));
    expect(result.success && result.data.filtered[0].reasons).toContain("STRICT_AVOIDANCE_CONFLICT");
  });

  it("不符合用餐时段被硬过滤", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { mealPeriod: "DINNER" })]));
    expect(result.success && result.data.filtered[0].reasons).toContain("MEAL_PERIOD_MISMATCH");
  });

  it("全天候选符合任意用餐时段", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { mealPeriod: "ALL_DAY" })]));
    expect(result.success && result.data.status).toBe("READY");
  });

  it("明确地点只影响便利分，不作为硬过滤", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { location: "西校区" })]));
    expect(result.success && result.data.recommendations[0].scoreBreakdown.locationConvenience).toBe(500);
  });

  it("超过临时或长期硬上限被过滤", () => {
    const temporary = rankMealCandidates(rankInput([candidate("a", { typicalPriceCents: 2_100 })], { temporaryPreferences: { mealPeriod: "LUNCH", location: "东校区", hardPriceLimitCents: 2_000 } }));
    const longTerm = rankMealCandidates(rankInput([candidate("a", { typicalPriceCents: 2_600 })]));
    expect(temporary.success && temporary.data.filtered[0].reasons).toContain("HARD_PRICE_LIMIT_EXCEEDED");
    expect(longTerm.success && longTerm.data.filtered[0].reasons).toContain("HARD_PRICE_LIMIT_EXCEEDED");
  });

  it("预算适配占3500分且超建议价格递减", () => {
    const result = rankMealCandidates(rankInput([candidate("cheap"), candidate("costly", { typicalPriceCents: 2_000 })]));
    if (result.success) {
      expect(result.data.recommendations.find((item) => item.candidateId === "cheap")?.scoreBreakdown.budgetFit).toBe(3_500);
      expect(result.data.recommendations.find((item) => item.candidateId === "costly")?.scoreBreakdown.budgetFit).toBe(1_750);
    }
  });

  it("喜欢加分且不喜欢强降分", () => {
    const liked = candidate("liked", { tags: ["米饭"] });
    const disliked = candidate("disliked", { tags: ["香菜"] });
    const result = rankMealCandidates(rankInput([liked, disliked]));
    if (result.success) expect(result.data.recommendations[0].candidateId).toBe("liked");
  });

  it("近期重复按次数降低15%分项，TRY_DIFFERENT强化惩罚", () => {
    const recent = { recentMeals: [{ id: "1", name: "餐食a", merchant: null, amountCents: 1_500, occurredAt: new Date("2026-07-14T00:00:00Z") }] };
    const normal = rankMealCandidates(rankInput([candidate("a")], { recentMealContext: recent }));
    const different = rankMealCandidates(rankInput([candidate("a")], { recentMealContext: recent, temporaryPreferences: { mealPeriod: "LUNCH", location: "东校区", hardPriceLimitCents: 2_500, quickTags: ["TRY_DIFFERENT"] } }));
    expect(normal.success && normal.data.recommendations[0].scoreBreakdown.recentVariety).toBe(750);
    expect(normal.success && normal.data.recommendations[0].risks).toContain("RECENTLY_EATEN");
    expect(different.success && different.data.recommendations[0].scoreBreakdown.recentVariety).toBe(0);
  });

  it("SAVE_MONEY让更便宜候选获得更高预算分", () => {
    const candidates = [candidate("cheap", { typicalPriceCents: 900 }), candidate("normal", { typicalPriceCents: 1_500 })];
    const normal = rankMealCandidates(rankInput(candidates));
    const saving = rankMealCandidates(rankInput(candidates, { temporaryPreferences: { mealPeriod: "LUNCH", location: "东校区", hardPriceLimitCents: 2_500, quickTags: ["SAVE_MONEY"] } }));
    if (normal.success && saving.success) {
      expect(normal.data.recommendations.find((item) => item.candidateId === "cheap")?.scoreBreakdown.budgetFit).toBe(3_500);
      expect(saving.data.recommendations.find((item) => item.candidateId === "cheap")?.scoreBreakdown.budgetFit).toBeGreaterThan(saving.data.recommendations.find((item) => item.candidateId === "normal")?.scoreBreakdown.budgetFit ?? 0);
    }
  });

  it("历史评分按每星200分，无评分得500分", () => {
    const result = rankMealCandidates(rankInput([candidate("rated", { userRating: 5 }), candidate("none", { userRating: null })]));
    if (result.success) {
      expect(result.data.recommendations.find((item) => item.candidateId === "rated")?.scoreBreakdown.historicalRating).toBe(1_000);
      expect(result.data.recommendations.find((item) => item.candidateId === "none")?.scoreBreakdown.historicalRating).toBe(500);
    }
  });

  it("地点便利占1000分", () => {
    const result = rankMealCandidates(rankInput());
    expect(result.success && result.data.recommendations[0].scoreBreakdown.locationConvenience).toBe(1_000);
  });

  it("最多返回4个且候选不重复", () => {
    const result = rankMealCandidates(rankInput([candidate("a"), candidate("b", { userRating: 3 }), candidate("c", { userRating: 2 }), candidate("d", { userRating: 1 }), candidate("e")]));
    if (result.success) {
      expect(result.data.recommendations).toHaveLength(4);
      expect(new Set(result.data.recommendations.map((item) => item.candidateId)).size).toBe(4);
      expect(result.data.recommendations.map((item) => item.recommendationType)).toEqual(["OVERALL", "SAVE_MONEY", "TASTE", "NEW_OR_CONVENIENT"]);
    }
  });

  it("相同输入产生相同输出并稳定打破平局", () => {
    const input = rankInput([candidate("b"), candidate("a")]);
    const first = rankMealCandidates(input);
    const second = rankMealCandidates(input);
    expect(first).toEqual(second);
    if (first.success) expect(first.data.recommendations.map((item) => item.candidateId)).toEqual(["a", "b"]);
  });

  it("所有候选违反硬规则时返回明确状态且不编造结果", () => {
    const result = rankMealCandidates(rankInput([candidate("a", { enabled: false }), candidate("b", { ingredients: ["花生"] })]));
    expect(result.success && result.data).toMatchObject({ status: "NO_ELIGIBLE_CANDIDATES", recommendations: [] });
  });

  it("无效金额和评分返回INVALID_INPUT", () => {
    expect(rankMealCandidates(rankInput([candidate("a", { typicalPriceCents: -1 })]))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(rankMealCandidates(rankInput([candidate("a", { userRating: 6 })]))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("simulate_budget_impact", () => {
  it("计算购买后的总预算", () => {
    const result = simulateBudgetImpact({ candidatePriceCents: 1_500, financialContext });
    expect(result.success && result.data).toMatchObject({ remainingBudgetAfterCents: 88_500, mealRemainingAfterCents: 88_500 });
  });

  it("建议价格相等不算超出，高于才超出", () => {
    expect(simulateBudgetImpact({ candidatePriceCents: 1_500, financialContext })).toMatchObject({ success: true, data: { exceedsRecommendedPrice: false } });
    expect(simulateBudgetImpact({ candidatePriceCents: 1_501, financialContext })).toMatchObject({ success: true, data: { exceedsRecommendedPrice: true } });
  });

  it("硬上限相等不算超出，高于才超出", () => {
    expect(simulateBudgetImpact({ candidatePriceCents: 2_500, financialContext })).toMatchObject({ success: true, data: { exceedsHardLimit: false } });
    expect(simulateBudgetImpact({ candidatePriceCents: 2_501, financialContext })).toMatchObject({ success: true, data: { exceedsHardLimit: true } });
  });

  it("旧正餐余额不再触发分类超支", () => {
    const context = { ...financialContext, mealRemainingCents: 1_000 };
    expect(simulateBudgetImpact({ candidatePriceCents: 1_500, financialContext: context })).toMatchObject({ success: true, data: { mealRemainingAfterCents: 88_500, causesMealBudgetOverrun: false } });
  });

  it("购买后建议日预算向下取整", () => {
    const context = { ...financialContext, remainingBudgetCents: 10_001, remainingDays: 3 };
    expect(simulateBudgetImpact({ candidatePriceCents: 1, financialContext: context })).toMatchObject({ success: true, data: { recommendedDailyBudgetAfterCents: 3_333, recommendedDailyBudgetAfterStatus: "AVAILABLE" } });
  });

  it("剩余天数为0时日预算为0并返回周期结束", () => {
    const context = { ...financialContext, remainingDays: 0 };
    expect(simulateBudgetImpact({ candidatePriceCents: 100, financialContext: context })).toMatchObject({ success: true, data: { recommendedDailyBudgetAfterCents: 0, recommendedDailyBudgetAfterStatus: "PERIOD_ENDED" } });
  });

  it("总预算耗尽时日预算为0且储蓄目标异常", () => {
    const context = { ...financialContext, remainingBudgetCents: 1_000 };
    expect(simulateBudgetImpact({ candidatePriceCents: 1_500, financialContext: context })).toMatchObject({ success: true, data: { remainingBudgetAfterCents: -500, recommendedDailyBudgetAfterCents: 0, recommendedDailyBudgetAfterStatus: "NO_REMAINING_BUDGET", savingsTargetStillOnTrack: false } });
  });

  it("未配置储蓄目标时保持正常", () => {
    const context = { ...financialContext, remainingBudgetCents: 100, savingsTarget: { status: "NOT_CONFIGURED" as const, targetCents: 0 } };
    expect(simulateBudgetImpact({ candidatePriceCents: 1_500, financialContext: context })).toMatchObject({ success: true, data: { savingsTargetStillOnTrack: true } });
  });

  it("拒绝零、负数、小数和非安全整数价格", () => {
    for (const price of [0, -1, 1.5, Number.MAX_VALUE]) expect(simulateBudgetImpact({ candidatePriceCents: price, financialContext })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
