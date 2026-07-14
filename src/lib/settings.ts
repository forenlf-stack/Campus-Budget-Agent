import { z } from "zod";

import {
  calculateBudgetStatus,
  calculateFlexibleBudget,
  transactionCategories,
  type TransactionCategory,
} from "./budget";

const cents = z.number().int().safe().nonnegative();
const category = z.enum(transactionCategories);

export const settingsSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  monthlyAllowanceCents: cents,
  currentBalanceCents: cents,
  fixedExpenseCents: cents,
  monthlySavingsTargetCents: cents,
  requiredReserveCents: cents,
  allowanceDay: z.number().int().min(1).max(31),
  defaultLocation: z.string().trim().max(100),
  categoryBudgets: z.array(z.object({ category, budgetCents: cents })).length(transactionCategories.length),
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
  if (new Set(input.categoryBudgets.map((item) => item.category)).size !== transactionCategories.length) {
    context.addIssue({ code: "custom", path: ["categoryBudgets"], message: "分类预算必须包含九个不同类别" });
    return;
  }
  const flexibleBudgetCents = calculateFlexibleBudget({
    periodIncomeCents: input.monthlyAllowanceCents,
    plannedFixedExpensesCents: input.fixedExpenseCents,
    plannedSavingsCents: input.monthlySavingsTargetCents,
    requiredReserveCents: input.requiredReserveCents,
  });
  const status = calculateBudgetStatus({
    flexibleBudgetCents,
    plannedVariableBudgetCents: Math.max(flexibleBudgetCents, 0),
    actualNetVariableSpendingCents: 0,
    categoryBudgets: input.categoryBudgets,
  });
  if (status === "INVALID_PLAN") {
    const allocated = input.categoryBudgets.reduce((total, item) => total + item.budgetCents, 0);
    const message = flexibleBudgetCents < 0
      ? "月生活费不足以覆盖固定支出、储蓄目标和必要预留资金"
      : `分类预算总和不能超过可变消费预算，还需减少 ${(allocated - flexibleBudgetCents) / 100} 元`;
    context.addIssue({ code: "custom", path: ["categoryBudgets"], message });
  }
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export function calculateSettingsSummary(input: SettingsInput) {
  const flexibleBudgetCents = calculateFlexibleBudget({
    periodIncomeCents: input.monthlyAllowanceCents,
    plannedFixedExpensesCents: input.fixedExpenseCents,
    plannedSavingsCents: input.monthlySavingsTargetCents,
    requiredReserveCents: input.requiredReserveCents,
  });
  const allocatedBudgetCents = input.categoryBudgets.reduce((total, item) => total + item.budgetCents, 0);
  return {
    flexibleBudgetCents,
    allocatedBudgetCents,
    unallocatedBudgetCents: flexibleBudgetCents - allocatedBudgetCents,
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
