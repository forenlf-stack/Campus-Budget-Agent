import { describe, expect, it } from "vitest";

import { type BudgetTransaction } from "@/lib/budget";
import type { SettingsInput } from "@/lib/settings";
import type { MealCandidateRecord } from "@/server/meal-candidate-store";
import type { MealTransaction, SkillReadStore } from "@/server/skill-read-store";
import { getFinancialContext } from "./get-financial-context";
import { getRecentMealConsumption } from "./get-recent-meal-consumption";
import { retrieveMealCandidates } from "./retrieve-meal-candidates";

const queryDate = new Date("2026-07-14T12:00:00+08:00");
const settings: SettingsInput = {
  period: "2026-07",
  monthlyAllowanceCents: 220_000,
  currentBalanceCents: 350_000,
  fixedExpenseCents: 60_000,
  monthlySavingsTargetCents: 40_000,
  requiredReserveCents: 10_000,
  allowanceDay: 1,
  defaultLocation: "东校区",
    totalBudgetCents: 110_000,
  recommendedLunchPriceCents: 1_500,
  lunchHardLimitCents: 2_500,
  weeklySnackDrinkLimit: 2,
  weeklySnackDrinkBudgetCents: 2_000,
  shoppingReminderThresholdCents: 5_000,
  coolingOffHours: 24,
  foodLikes: [],
  foodDislikes: [],
  foodAllergens: [],
  protectedCategories: [],
};

const periodTransactions: BudgetTransaction[] = [
  { id: "meal", type: "EXPENSE", category: "MEAL", amountCents: 1_300, occurredAt: new Date("2026-07-10T12:00:00+08:00"), isFixedExpense: false },
  { id: "other", type: "EXPENSE", category: "OTHER", amountCents: 700, occurredAt: new Date("2026-07-11T12:00:00+08:00"), isFixedExpense: false },
  { id: "fixed", type: "EXPENSE", category: "OTHER", amountCents: 60_000, occurredAt: new Date("2026-07-01T12:00:00+08:00"), isFixedExpense: true },
];

const recentMeals: MealTransaction[] = [
  { id: "m3", type: "EXPENSE", category: "MEAL", amountCents: 2_000, occurredAt: new Date("2026-07-14T11:00:00+08:00"), isFixedExpense: false, itemName: "牛肉面", merchant: "面馆" },
  { id: "m2", type: "EXPENSE", category: "MEAL", amountCents: 1_600, occurredAt: new Date("2026-07-13T12:00:00+08:00"), isFixedExpense: false, itemName: "鸡腿饭", merchant: "食堂" },
  { id: "m1", type: "EXPENSE", category: "MEAL", amountCents: 1_200, occurredAt: new Date("2026-07-12T12:00:00+08:00"), isFixedExpense: false, itemName: "鸡腿饭", merchant: "食堂" },
  { id: "refund", type: "REFUND", category: "MEAL", amountCents: 500, occurredAt: new Date("2026-07-14T10:00:00+08:00"), isFixedExpense: false, itemName: "退款", merchant: "食堂" },
];

const candidate: MealCandidateRecord = {
  id: "meal-1", name: "鸡腿饭", merchant: "第一食堂", typicalPriceCents: 1_500, location: "东校区", mealPeriod: "LUNCH",
  tags: ["米饭"], ingredients: ["鸡肉"], isSpicy: false, userRating: 5, lastPurchasedAt: null,
  priceUpdatedAt: "2026-07-01T00:00:00.000Z", dataSource: "SEED", enabled: true,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
};

function store(overrides: Partial<SkillReadStore> = {}): SkillReadStore {
  return {
    readSettings: () => settings,
    readPeriodTransactions: () => periodTransactions,
    readMealTransactions: () => recentMeals,
    readMealCandidates: () => [candidate],
    ...overrides,
  };
}

describe("get_financial_context", () => {
  it("复用预算公式返回完整财务上下文", () => {
    const result = getFinancialContext({ queryDate }, store());
    if (!result.success) throw new Error(JSON.stringify(result.error));
    if (result.success) expect(result.data).toMatchObject({ budgetPeriod: "2026-07", flexibleBudgetCents: 110_000, actualNetSpendingCents: 2_000, remainingBudgetCents: 108_000, mealBudgetCents: 110_000, mealUsedCents: 2_000, mealRemainingCents: 108_000 });
  });

  it("支持显式预算周期", () => {
    const result = getFinancialContext({ queryDate, budgetPeriod: "2026-07" }, store());
    expect(result.success && result.data.budgetPeriod).toBe("2026-07");
  });

  it("固定支出不会重复计入实际净支出", () => {
    const result = getFinancialContext({ queryDate }, store());
    expect(result.success && result.data.actualNetSpendingCents).toBe(2_000);
  });

  it("额外收入不自动扩大用户设定的总预算", () => {
    const incomeTransactions: BudgetTransaction[] = [
      ...periodTransactions,
      { id: "allowance", type: "INCOME", category: null, amountCents: 220_000, occurredAt: new Date("2026-07-01T09:00:00+08:00"), isFixedExpense: false },
      { id: "temporary", type: "INCOME", category: null, amountCents: 5_000, occurredAt: new Date("2026-07-07T10:00:00+08:00"), isFixedExpense: false },
    ];
    const result = getFinancialContext({ queryDate }, store({ readPeriodTransactions: () => incomeTransactions }));
    expect(result.success && result.data.flexibleBudgetCents).toBe(110_000);
    expect(result.success && result.data.remainingBudgetCents).toBe(108_000);
  });

  it("未记录完整计划收入时不会误减计划预算", () => {
    const partialIncome: BudgetTransaction[] = [
      ...periodTransactions,
      { id: "temporary", type: "INCOME", category: null, amountCents: 5_000, occurredAt: new Date("2026-07-07T10:00:00+08:00"), isFixedExpense: false },
    ];
    const result = getFinancialContext({ queryDate }, store({ readPeriodTransactions: () => partialIncome }));
    expect(result.success && result.data.flexibleBudgetCents).toBe(110_000);
  });

  it("返回向下取整的建议日预算和剩余天数", () => {
    const result = getFinancialContext({ queryDate }, store());
    expect(result.success && result.data.remainingDays).toBe(18);
    expect(result.success && result.data.recommendedDailyBudgetCents).toBe(6_000);
  });

  it("返回储蓄目标状态", () => {
    const result = getFinancialContext({ queryDate }, store());
    expect(result.success && result.data.savingsTarget).toEqual({ status: "CONFIGURED", targetCents: 40_000 });
  });

  it("余额随消费下降后不会让既有月预算上下文失效", () => {
    const changedBalance = { ...settings, currentBalanceCents: 100_000 };
    const result = getFinancialContext({ queryDate }, store({ readSettings: () => changedBalance }));
    expect(result).toMatchObject({ success: true, data: { flexibleBudgetCents: 110_000, remainingBudgetCents: 108_000 } });
  });

  it("拒绝无效日期和周期", () => {
    expect(getFinancialContext({ queryDate: new Date("invalid") }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(getFinancialContext({ queryDate, budgetPeriod: "2026-13" }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("get_recent_meal_consumption", () => {
  it("统计近期正餐次数、总额和平均价格", () => {
    const result = getRecentMealConsumption({ queryDate }, store());
    expect(result.success && result.data).toMatchObject({ days: 14, mealCount: 3, totalCents: 4_800, averagePriceCents: 1_600 });
  });

  it("默认只返回最近3次并去重名称", () => {
    const result = getRecentMealConsumption({ queryDate }, store());
    if (result.success) {
      expect(result.data.recentMeals).toHaveLength(3);
      expect(result.data.recentMealNames).toEqual(["牛肉面", "鸡腿饭"]);
    }
  });

  it("退款不作为一次正餐或平均价格样本", () => {
    const result = getRecentMealConsumption({ queryDate }, store());
    expect(result.success && result.data.mealCount).toBe(3);
  });

  it("按原交易关联退款，部分退款使用净额", () => {
    const transactions: MealTransaction[] = [
      { ...recentMeals[0], id: "partial", amountCents: 2_000 },
      { id: "partial-refund", type: "REFUND", category: "MEAL", amountCents: 500, occurredAt: new Date("2026-07-14T11:30:00+08:00"), isFixedExpense: false, itemName: "退款", merchant: "面馆", originalTransactionId: "partial" },
    ];
    const result = getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => transactions }));
    expect(result).toMatchObject({ success: true, data: { mealCount: 1, totalCents: 1_500, averagePriceCents: 1_500, recentAveragePriceCents: 1_500 } });
    if (result.success) expect(result.data.recentMeals[0]?.amountCents).toBe(1_500);
  });

  it("全额或超额退款的原交易不计次数和均价", () => {
    const transactions: MealTransaction[] = [
      { ...recentMeals[0], id: "full", amountCents: 2_000 },
      { ...recentMeals[1], id: "kept", amountCents: 1_600 },
      { id: "full-refund-1", type: "REFUND", category: "MEAL", amountCents: 1_200, occurredAt: new Date("2026-07-14T11:30:00+08:00"), isFixedExpense: false, itemName: "退款", merchant: "面馆", originalTransactionId: "full" },
      { id: "full-refund-2", type: "REFUND", category: "MEAL", amountCents: 900, occurredAt: new Date("2026-07-14T11:40:00+08:00"), isFixedExpense: false, itemName: "退款", merchant: "面馆", originalTransactionId: "full" },
    ];
    expect(getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => transactions }))).toMatchObject({ success: true, data: { mealCount: 1, totalCents: 1_600, averagePriceCents: 1_600 } });
  });

  it("不将缺少原交易关联的退款错误抵扣其他餐食", () => {
    const transactions: MealTransaction[] = [recentMeals[0], { ...recentMeals[3], amountCents: 2_000 }];
    expect(getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => transactions }))).toMatchObject({ success: true, data: { mealCount: 1, totalCents: 2_000 } });
  });

  it("最近3次平均价严格超过建议价120%时触发并返回证据", () => {
    const expensiveMeals = recentMeals.slice(0, 3).map((meal) => ({ ...meal, amountCents: 1_801 }));
    const result = getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => expensiveMeals }));
    expect(result.success && result.data.highRecentPriceTriggered).toBe(true);
    if (result.success) expect(result.data.highPriceEvidence).toEqual({ thresholdCents: 1_800, recentAveragePriceCents: 1_801, comparedMealCount: 3, rule: "RECENT_AVERAGE_ABOVE_120_PERCENT_RECOMMENDED_LUNCH_PRICE" });
  });

  it("样本少于3次或平均价等于120%时不触发", () => {
    const exactThreshold = recentMeals.slice(0, 3).map((meal) => ({ ...meal, amountCents: 1_800 }));
    const insufficient = recentMeals.slice(0, 2).map((meal) => ({ ...meal, amountCents: 3_000 }));
    expect(getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => exactThreshold }))).toMatchObject({ success: true, data: { highRecentPriceTriggered: false } });
    expect(getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => insufficient }))).toMatchObject({ success: true, data: { highRecentPriceTriggered: false } });
  });

  it("空交易返回零值且不触发", () => {
    const result = getRecentMealConsumption({ queryDate }, store({ readMealTransactions: () => [] }));
    expect(result.success && result.data).toMatchObject({ mealCount: 0, totalCents: 0, averagePriceCents: 0, recentAveragePriceCents: 0, highRecentPriceTriggered: false });
  });

  it("允许覆盖days和recentCount", () => {
    const result = getRecentMealConsumption({ queryDate, days: 14, recentCount: 2 }, store());
    expect(result.success && result.data.days).toBe(14);
    expect(result.success && result.data.recentMeals).toHaveLength(2);
  });

  it("拒绝非法days和recentCount", () => {
    expect(getRecentMealConsumption({ queryDate, days: 0 }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(getRecentMealConsumption({ queryDate, recentCount: 1.5 }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("retrieve_meal_candidates", () => {
  it("返回候选及价格来源和更新时间", () => {
    const result = retrieveMealCandidates({ mealPeriod: "LUNCH" }, store());
    expect(result.success && result.data.count).toBe(1);
    if (result.success) expect(result.data.candidates[0]).toMatchObject({ typicalPriceCents: 1_500, priceSource: "SEED", priceUpdatedAt: "2026-07-01T00:00:00.000Z" });
  });

  it("默认只查询启用候选", () => {
    let received: unknown;
    retrieveMealCandidates({ mealPeriod: "DINNER" }, store({ readMealCandidates: (filters) => { received = filters; return []; } }));
    expect(received).toMatchObject({ mealPeriod: "DINNER", enabledOnly: true });
  });

  it("传递地点、价格和启用筛选", () => {
    let received: unknown;
    retrieveMealCandidates({ mealPeriod: "LUNCH", location: "东校区", maximumPriceCents: 2_000, enabledOnly: false }, store({ readMealCandidates: (filters) => { received = filters; return []; } }));
    expect(received).toEqual({ mealPeriod: "LUNCH", location: "东校区", maximumPriceCents: 2_000, enabledOnly: false });
  });

  it("拒绝负数、小数和非安全整数价格", () => {
    expect(retrieveMealCandidates({ mealPeriod: "LUNCH", maximumPriceCents: -1 }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(retrieveMealCandidates({ mealPeriod: "LUNCH", maximumPriceCents: 1.5 }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(retrieveMealCandidates({ mealPeriod: "LUNCH", maximumPriceCents: Number.MAX_VALUE }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });

  it("拒绝非法餐食时段", () => {
    expect(retrieveMealCandidates({ mealPeriod: "BRUNCH" }, store())).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
