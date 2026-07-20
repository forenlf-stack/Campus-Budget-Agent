import { describe, expect, it } from "vitest";

import { centsToYuan, yuanToCents } from "./money";
import { calculateSettingsSummary, settingsSchema, type SettingsInput } from "./settings";

function validSettings(): SettingsInput {
  return {
    period: "2026-07",
    monthlyAllowanceCents: 220_000,
    currentBalanceCents: 350_000,
    fixedExpenseCents: 60_000,
    monthlySavingsTargetCents: 40_000,
    requiredReserveCents: 10_000,
    allowanceDay: 1,
    defaultLocation: "学校东区",
    totalBudgetCents: 110_000,
    recommendedLunchPriceCents: 1_500,
    lunchHardLimitCents: 2_500,
    weeklySnackDrinkLimit: 3,
    weeklySnackDrinkBudgetCents: 3_000,
    shoppingReminderThresholdCents: 10_000,
    coolingOffHours: 24,
    foodLikes: ["米饭"],
    foodDislikes: ["香菜"],
    foodAllergens: ["花生"],
    protectedCategories: ["MEAL", "STUDY"],
  };
}

describe("资金与偏好设置", () => {
  it("精确转换元和分", () => {
    expect(yuanToCents("2200")).toBe(220_000);
    expect(yuanToCents("15.08")).toBe(1_508);
    expect(centsToYuan(1_508)).toBe("15.08");
  });

  it("拒绝负数和超过两位的小数金额", () => {
    expect(() => yuanToCents("-1")).toThrow();
    expect(() => yuanToCents("1.001")).toThrow();
  });

  it("验收案例的可变消费预算为 1100 元", () => {
    const summary = calculateSettingsSummary(validSettings());

    expect(summary.totalBudgetCents).toBe(110_000);
  });

  it("午餐建议价格不能超过硬上限", () => {
    const input = validSettings();
    input.recommendedLunchPriceCents = 3_000;

    expect(settingsSchema.safeParse(input).success).toBe(false);
  });

  it("总预算不能超过扣除计划后的可用金额", () => {
    const input = validSettings();
    input.totalBudgetCents = 120_000;

    expect(settingsSchema.safeParse(input).success).toBe(false);
  });

  it("固定支出、储蓄和预留超过生活费时配置不可行", () => {
    const input = validSettings();
    input.fixedExpenseCents = 180_000;

    expect(settingsSchema.safeParse(input).success).toBe(false);
  });
});
