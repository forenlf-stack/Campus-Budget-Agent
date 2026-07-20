import { z } from "zod";

import { transactionCategories, type TransactionCategory } from "./budget";

const cents = z.number().int().safe().nonnegative();
const category = z.enum(transactionCategories);

export const settingsSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  monthlyAllowanceCents: cents,
  currentBalanceCents: cents,
  fixedExpenseCents: cents,
  monthlySavingsTargetCents: cents,
  requiredReserveCents: cents,
  totalBudgetCents: cents,
  allowanceDay: z.number().int().min(1).max(31),
  defaultLocation: z.string().trim().max(100),
  recommendedLunchPriceCents: cents,
  lunchHardLimitCents: cents,
  weeklySnackDrinkLimit: z.number().int().min(0).max(100),
  weeklySnackDrinkBudgetCents: cents,
  shoppingReminderThresholdCents: cents,
  coolingOffHours: z.number().int().min(0).max(720),
  foodLikes: z.array(z.string().trim().min(1).max(50)).max(50),
  foodDislikes: z.array(z.string().trim().min(1).max(50)).max(50),
  foodAllergens: z.array(z.string().trim().min(1).max(50)).max(50),
  protectedCategories: z.array(category).max(transactionCategories.length),
}).superRefine((input, context) => {
  if (input.recommendedLunchPriceCents > input.lunchHardLimitCents) {
    context.addIssue({ code: "custom", path: ["recommendedLunchPriceCents"], message: "午餐建议价格不能超过午餐硬上限" });
  }
  const availableCents = input.monthlyAllowanceCents - input.fixedExpenseCents - input.monthlySavingsTargetCents - input.requiredReserveCents;
  if (input.totalBudgetCents > Math.max(availableCents, 0)) {
    context.addIssue({ code: "custom", path: ["totalBudgetCents"], message: "总预算不能超过扣除固定支出、储蓄目标和预留资金后的可用金额" });
  }
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export function calculateSettingsSummary(input: SettingsInput) {
  const availableAfterPlansCents = input.monthlyAllowanceCents - input.fixedExpenseCents - input.monthlySavingsTargetCents - input.requiredReserveCents;
  return {
    totalBudgetCents: input.totalBudgetCents,
    availableAfterPlansCents,
    unbudgetedCents: availableAfterPlansCents - input.totalBudgetCents,
  };
}

export const categoryLabels: Record<TransactionCategory, string> = {
  MEAL: "正餐",
  SNACK_DRINK: "零食饮料",
  DAILY_NECESSITY: "日用品",
  STUDY: "学习",
  TRANSPORT: "交通",
  GAME_ENTERTAINMENT: "游戏娱乐",
  RECHARGE_SUBSCRIPTION: "充值订阅",
  MEDICAL: "医疗",
  OTHER: "其他",
};
