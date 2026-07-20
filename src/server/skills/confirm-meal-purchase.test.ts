import { describe, expect, it, vi } from "vitest";

import type { SettingsInput } from "@/lib/settings";
import type { SkillReadStore } from "@/server/skill-read-store";
import { confirmMealPurchase } from "./confirm-meal-purchase";

const input = {
  idempotencyKey: "4bc67e55-2264-4c1f-ab24-65df42dd19c2",
  recommendationRunId: "run-1",
  candidateId: "meal-1",
  itemName: "鸡腿饭",
  source: "HISTORY" as const,
  recommendationType: "OVERALL" as const,
  recommendationRisk: "暂无明显风险",
  recommendedPriceCents: 1_500,
  actualPriceCents: 1_700,
  occurredAt: "2026-07-16T12:00:00.000Z",
};

const settings: SettingsInput = {
  period: "2026-07", monthlyAllowanceCents: 220_000, currentBalanceCents: 350_000, fixedExpenseCents: 60_000,
  monthlySavingsTargetCents: 40_000, requiredReserveCents: 10_000, allowanceDay: 1, defaultLocation: "东校区",
    totalBudgetCents: 110_000,
  recommendedLunchPriceCents: 1_500, lunchHardLimitCents: 2_500, weeklySnackDrinkLimit: 2,
  weeklySnackDrinkBudgetCents: 2_000, shoppingReminderThresholdCents: 5_000, coolingOffHours: 24,
  foodLikes: [], foodDislikes: [], foodAllergens: [], protectedCategories: [],
};

const store: SkillReadStore = {
  readSettings: () => settings,
  readPeriodTransactions: () => [],
  readMealTransactions: () => [],
  readMealCandidates: () => [],
};

describe("confirm_meal_purchase", () => {
  it("使用实际金额模拟并在写入后返回真实预算", () => {
    const getFinancialContext = vi.fn()
      .mockReturnValueOnce({ success: true, data: {
        budgetPeriod: "2026-07", flexibleBudgetCents: 110_000, actualNetSpendingCents: 0, remainingBudgetCents: 110_000,
        mealBudgetCents: 55_000, mealUsedCents: 0, mealRemainingCents: 55_000, remainingDays: 16,
        recommendedDailyBudgetCents: 6_875, recommendedDailyBudgetStatus: "AVAILABLE", recommendedLunchPriceCents: 1_500,
        lunchHardLimitCents: 2_500, savingsTarget: { status: "CONFIGURED", targetCents: 40_000 },
      } })
      .mockReturnValueOnce({ success: true, data: {
        remainingBudgetCents: 108_300, mealRemainingCents: 53_300, recommendedDailyBudgetCents: 6_768,
      } });
    const simulateBudgetImpact = vi.fn().mockReturnValue({ success: true, data: {
      remainingBudgetAfterCents: 108_300, mealRemainingAfterCents: 53_300,
      recommendedDailyBudgetAfterCents: 6_768, savingsTargetStillOnTrack: true,
    } });
    const record = vi.fn().mockReturnValue({
      decisionId: "decision-1", transactionId: "transaction-1", idempotent: false,
      budgetImpact: { remainingBudgetAfterCents: 108_300, mealRemainingAfterCents: 53_300, recommendedDailyBudgetAfterCents: 6_768, savingsTargetStillOnTrack: true },
    });

    const result = confirmMealPurchase("user_demo_001", input, { store, getFinancialContext, simulateBudgetImpact, recordPurchasedMealDecision: record });
    expect(simulateBudgetImpact).toHaveBeenCalledWith(expect.objectContaining({ candidatePriceCents: 1_700 }));
    expect(record).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: { transactionId: "transaction-1", budgetAfter: { mealRemainingCents: 53_300 } } });
  });

  it("幂等重试直接返回保存的预算快照", () => {
    const financial = vi.fn().mockReturnValue({ success: true, data: {
      budgetPeriod: "2026-07", flexibleBudgetCents: 110_000, actualNetSpendingCents: 0, remainingBudgetCents: 110_000,
      mealBudgetCents: 55_000, mealUsedCents: 0, mealRemainingCents: 55_000, remainingDays: 16,
      recommendedDailyBudgetCents: 6_875, recommendedDailyBudgetStatus: "AVAILABLE", recommendedLunchPriceCents: 1_500,
      lunchHardLimitCents: 2_500, savingsTarget: { status: "CONFIGURED", targetCents: 40_000 },
    } });
    const impact = { remainingBudgetAfterCents: 108_300, mealRemainingAfterCents: 53_300, recommendedDailyBudgetAfterCents: 6_768, savingsTargetStillOnTrack: true };
    const result = confirmMealPurchase("user_demo_001", input, {
      store,
      getFinancialContext: financial,
      simulateBudgetImpact: vi.fn().mockReturnValue({ success: true, data: impact }),
      recordPurchasedMealDecision: vi.fn().mockReturnValue({ decisionId: "decision-1", transactionId: "transaction-1", idempotent: true, budgetImpact: impact }),
    });
    expect(financial).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: { idempotent: true, budgetAfter: { remainingBudgetCents: 108_300 } } });
  });
});
