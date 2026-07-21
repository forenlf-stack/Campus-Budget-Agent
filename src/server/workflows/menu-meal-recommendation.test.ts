import { describe, expect, it, vi } from "vitest";

import { type BudgetTransaction } from "@/lib/budget";
import type { MenuCandidate } from "@/lib/menu-meal-recommendations";
import type { SettingsInput } from "@/lib/settings";
import type { MealTransaction, SkillReadStore } from "@/server/skill-read-store";
import { runMenuMealRecommendation } from "./menu-meal-recommendation";

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

function store(overrides: Partial<SkillReadStore> = {}): SkillReadStore {
  return { readSettings: () => settings, readPeriodTransactions: () => transactions, readMealTransactions: () => recentMeals, readMealCandidates: () => [], ...overrides };
}

function menuCandidate(temporaryId: string, overrides: Partial<MenuCandidate> = {}): MenuCandidate {
  return {
    temporaryId, name: `餐食${temporaryId}`, priceCents: 1_500, priceText: "15元", description: "米饭",
    visibleTags: ["米饭"], confidence: 0.95, source: "VISION", rawTextReference: `餐食${temporaryId} 15元`,
    needsConfirmation: false, risks: [], ...overrides,
  };
}

function run(candidates: MenuCandidate[], overrides: Parameters<typeof runMenuMealRecommendation>[1] = {}, confirmedPrices: Array<{ temporaryId: string; priceCents: number }> = []) {
  return runMenuMealRecommendation(
    { source: { type: "image", image: "base64", mimeType: "image/jpeg" }, confirmedPrices, date },
    {
      store: store(), createRunId: () => "menu-run", now: () => date,
      extractMenuCandidates: vi.fn().mockResolvedValue({ success: true, data: { candidates, rejectedCandidateCount: 0 } }),
      ...overrides,
    },
  );
}

describe("menu meal recommendation workflow", () => {
  it("清晰菜单复用排序和预算模拟且返回契约化耗时", async () => {
    const rank = vi.fn().mockReturnValue({
      success: true,
      data: { status: "READY", filtered: [], recommendations: [{
        candidateId: "a", totalScore: 8_000, scoreBreakdown: { budgetFit: 3_500, preferenceMatch: 1_500, recentVariety: 1_500, historicalRating: 500, locationConvenience: 1_000 },
        estimatedPriceCents: 1_500, recommendationLevel: "STRONG", recommendationType: "OVERALL", reasons: ["WITHIN_RECOMMENDED_PRICE"], risks: [], dataSource: "VISION", priceUpdatedAt: date.toISOString(),
      }] },
    });
    const simulate = vi.fn().mockReturnValue({ success: true, data: { remainingBudgetAfterCents: 106_500, mealRemainingAfterCents: 51_500, recommendedDailyBudgetAfterCents: 5_916, savingsTargetStillOnTrack: true } });
    const result = await run([menuCandidate("a"), menuCandidate("b")], { rankMealCandidates: rank, simulateBudgetImpact: simulate });

    expect(rank).toHaveBeenCalledOnce();
    expect(simulate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: {
      status: "READY",
      source: "image",
      recognition: { source: "image", detectedCount: 2, validCount: 2, rejectedCount: 0, warnings: [] },
      recommendations: [{ candidateId: "a", shortTags: ["价格合适"], risk: "暂无明显风险" }],
      timing: { extractionMs: expect.any(Number), contextMs: expect.any(Number), rankingMs: expect.any(Number), totalMs: expect.any(Number) },
    } });
  });

  it("无菜单内容直接返回空状态且不读取数据库", async () => {
    const readSettings = vi.fn(() => settings);
    const result = await run([], { store: store({ readSettings }) });
    expect(result).toMatchObject({ success: true, data: { status: "NO_MENU_CONTENT", recommendations: [] } });
    expect(readSettings).not.toHaveBeenCalled();
  });

  it("所有候选超过参考价时仍保留候选并展示风险", async () => {
    const result = await run([menuCandidate("a", { priceCents: 2_501 }), menuCandidate("b", { priceCents: 3_000 })]);
    expect(result).toMatchObject({ success: true, data: { status: "READY" } });
    if (result.success) expect(result.data.recommendations.every((item) => item.risk === "价格高于建议正餐价")).toBe(true);
  });

  it("所有候选命中严格忌口时返回无推荐", async () => {
    const result = await run([
      menuCandidate("a", { description: "花生拌饭", visibleTags: ["花生"] }),
      menuCandidate("b", { description: "花生面", visibleTags: ["花生"] }),
    ]);
    expect(result).toMatchObject({ success: true, data: { status: "NO_RECOMMENDATIONS", recommendations: [] } });
  });

  it("价格不确定候选只待确认，不参与排序", async () => {
    const rank = vi.fn().mockReturnValue({ success: true, data: { status: "NO_ELIGIBLE_CANDIDATES", recommendations: [], filtered: [] } });
    const uncertain = menuCandidate("a", { priceCents: 1_500, confidence: 0.5, needsConfirmation: true, risks: ["LOW_CONFIDENCE", "PRICE_UNCERTAIN"] });
    const result = await run([uncertain, menuCandidate("b", { priceCents: null, needsConfirmation: true, risks: ["PRICE_UNCERTAIN"] })], { rankMealCandidates: rank });
    expect(rank).toHaveBeenCalledWith(expect.objectContaining({ candidates: [] }));
    expect(result).toMatchObject({ success: true, data: { status: "NEEDS_PRICE_CONFIRMATION", pendingConfirmation: [{ temporaryId: "a" }, { temporaryId: "b" }] } });
    if (result.success) {
      expect(result.data.recognition.warnings).toEqual(expect.arrayContaining([
        "部分候选识别置信度较低，请核对菜名和价格",
        "部分价格不确定，确认实际价格后才能参与预算推荐",
      ]));
    }
  });

  it("确认价格后候选参与推荐且不会写库", async () => {
    const writeLikeOperation = vi.fn();
    const result = await run([
      menuCandidate("a", { priceCents: null, priceText: "价格不清", needsConfirmation: true, risks: ["PRICE_UNCERTAIN"] }),
      menuCandidate("b"),
    ], { store: store({ readMealCandidates: writeLikeOperation }) }, [{ temporaryId: "a", priceCents: 1_200 }]);
    expect(result.success && result.data.pendingConfirmation).toEqual([]);
    expect(result.success && result.data.recommendations.map((item) => item.candidateId)).toContain("a");
    expect(writeLikeOperation).not.toHaveBeenCalled();
  });

  it("单项预算模拟抛错时隔离失败并保留其他推荐", async () => {
    const simulate = vi.fn()
      .mockImplementationOnce(() => { throw new Error("simulation failed"); })
      .mockReturnValueOnce({ success: true, data: { remainingBudgetAfterCents: 100_000, mealRemainingAfterCents: 50_000, recommendedDailyBudgetAfterCents: 5_000, savingsTargetStillOnTrack: true } });
    const result = await run([menuCandidate("a"), menuCandidate("b")], { simulateBudgetImpact: simulate });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.recommendations).toHaveLength(2);
    expect(result.data.recommendations[0].details.budgetImpact).toBeNull();
    expect(result.data.recommendations[0].details.executionSteps.at(-1)).toEqual({ step: "simulate_budget_impact", status: "FAILED" });
    expect(result.data.recommendations[1].details.budgetImpact).not.toBeNull();
  });
});
