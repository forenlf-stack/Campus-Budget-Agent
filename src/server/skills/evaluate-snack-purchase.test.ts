import { describe, expect, it } from "vitest";

import type { BudgetTransaction } from "@/lib/budget";
import type { SettingsInput } from "@/lib/settings";
import type { SkillReadStore } from "@/server/skill-read-store";
import { evaluateSnackPurchase } from "./evaluate-snack-purchase";

const now = new Date("2026-07-17T12:00:00+08:00");
const settings: SettingsInput = {
  period: "2026-07", monthlyAllowanceCents: 220_000, currentBalanceCents: 350_000,
  fixedExpenseCents: 60_000, monthlySavingsTargetCents: 40_000, requiredReserveCents: 10_000,
  totalBudgetCents: 110_000, allowanceDay: 1, defaultLocation: "东校区",
  recommendedLunchPriceCents: 1_500, lunchHardLimitCents: 2_500,
  weeklySnackDrinkLimit: 2, weeklySnackDrinkBudgetCents: 2_000,
  shoppingReminderThresholdCents: 5_000, coolingOffHours: 24,
  foodLikes: [], foodDislikes: [], foodAllergens: [], protectedCategories: [],
};

function store(transactions: BudgetTransaction[] = []): SkillReadStore {
  return {
    readSettings: () => settings,
    readPeriodTransactions: () => transactions,
    readMealTransactions: () => [],
    readMealCandidates: () => [],
  };
}

function input(priceCents = 500) {
  return { itemName: "无糖茶", priceCents, merchant: "校园超市", occurredAt: now.toISOString() };
}

describe("evaluate_snack_purchase", () => {
  it("频率和金额均未触发时返回绿色建议", () => {
    expect(evaluateSnackPurchase(input(), store())).toMatchObject({ success: true, data: { level: "GREEN", recommendation: "BUY", agentComment: null, agentSource: "RULES", context: { previousWeekCount: 0, recentAveragePriceCents: 0, frequencyRemainingAfter: 1, weeklyBudgetRemainingAfterCents: 1_500 } } });
  });

  it("今天已经购买过时返回黄色提醒", () => {
    const transactions: BudgetTransaction[] = [{ id: "snack", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 600, occurredAt: new Date("2026-07-17T09:00:00+08:00"), isFixedExpense: false }];
    expect(evaluateSnackPurchase(input(), store(transactions))).toMatchObject({ success: true, data: { level: "YELLOW", context: { todayCount: 1 } } });
  });

  it("同时超过周次数和周金额时返回红色建议", () => {
    const transactions: BudgetTransaction[] = [
      { id: "one", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 900, occurredAt: new Date("2026-07-15T09:00:00+08:00"), isFixedExpense: false },
      { id: "two", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 900, occurredAt: new Date("2026-07-16T09:00:00+08:00"), isFixedExpense: false },
    ];
    const result = evaluateSnackPurchase(input(500), store(transactions));
    expect(result).toMatchObject({ success: true, data: { level: "RED", recommendation: "DELAY_OR_SKIP" } });
    if (result.success) expect(result.data.alternatives.join(" ")).not.toContain("1.00 元");
  });

  it("周额度已经用完时不生成不现实的最低价格建议", () => {
    const transactions: BudgetTransaction[] = [
      { id: "one", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 3_000, occurredAt: new Date("2026-07-15T09:00:00+08:00"), isFixedExpense: false },
    ];
    const result = evaluateSnackPurchase({ ...input(3_000), itemName: "水果葡萄1斤" }, store(transactions));
    expect(result).toMatchObject({ success: true, data: { level: "YELLOW" } });
    if (result.success) {
      expect(result.data.alternatives[0]).toContain("额度已经用完");
      expect(result.data.alternatives.join(" ")).not.toMatch(/不超过\s*1\.00\s*元/);
    }
  });

  it("提供前后两周对比和近期平均单价", () => {
    const transactions: BudgetTransaction[] = [
      { id: "current", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 600, occurredAt: new Date("2026-07-16T09:00:00+08:00"), isFixedExpense: false },
      { id: "previous", type: "EXPENSE", category: "SNACK_DRINK", amountCents: 400, occurredAt: new Date("2026-07-09T09:00:00+08:00"), isFixedExpense: false },
    ];
    expect(evaluateSnackPurchase(input(), store(transactions))).toMatchObject({ success: true, data: { context: { recentCount: 1, recentSpendingCents: 600, previousWeekCount: 1, previousWeekSpendingCents: 400, recentAveragePriceCents: 600 } } });
  });
});
