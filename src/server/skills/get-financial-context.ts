import { z } from "zod";

import { calculateNetVariableSpending, calculateRecommendedDailyBudget, calculateRemainingBudget } from "@/lib/budget";
import { budgetPeriodSchema, shanghaiPeriodBounds, shanghaiPeriodForDate } from "@/lib/period";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";

export const financialContextInputSchema = z.object({
  queryDate: z.date().refine((date) => Number.isFinite(date.getTime()), "查询日期无效"),
  budgetPeriod: budgetPeriodSchema.optional(),
});

export interface FinancialContextData {
  budgetPeriod: string;
  flexibleBudgetCents: number;
  actualNetSpendingCents: number;
  remainingBudgetCents: number;
  mealBudgetCents: number;
  mealUsedCents: number;
  mealRemainingCents: number;
  remainingDays: number;
  recommendedDailyBudgetCents: number;
  recommendedDailyBudgetStatus: "AVAILABLE" | "NO_REMAINING_BUDGET" | "PERIOD_ENDED";
  recommendedLunchPriceCents: number;
  lunchHardLimitCents: number;
  savingsTarget: { status: "CONFIGURED" | "NOT_CONFIGURED"; targetCents: number };
}

export function getFinancialContext(input: unknown, store: SkillReadStore = skillReadStore): SkillResult<FinancialContextData> {
  try {
    const parsed = financialContextInputSchema.parse(input);
    const budgetPeriod = parsed.budgetPeriod ?? shanghaiPeriodForDate(parsed.queryDate);
    const bounds = shanghaiPeriodBounds(budgetPeriod);
    const settings = store.readSettings(budgetPeriod);
    const transactions = store.readPeriodTransactions(bounds.start, bounds.end);
    const availableAfterPlansCents = settings.monthlyAllowanceCents - settings.fixedExpenseCents - settings.monthlySavingsTargetCents - settings.requiredReserveCents;
    if (settings.totalBudgetCents > Math.max(availableAfterPlansCents, 0)) {
      return skillFailure("INVALID_BUDGET_PLAN", "总预算超过扣除固定支出、储蓄目标和必要预留后的可用金额");
    }
    const flexibleBudgetCents = settings.totalBudgetCents;
    const actualNetSpendingCents = calculateNetVariableSpending({ transactions, periodStart: bounds.start, periodEnd: bounds.end });
    const remainingBudgetCents = calculateRemainingBudget({ plannedVariableBudgetCents: flexibleBudgetCents, actualNetVariableSpendingCents: actualNetSpendingCents });
    const daily = calculateRecommendedDailyBudget({ remainingBudgetCents, currentDate: parsed.queryDate, periodEnd: bounds.end });
    return skillSuccess({
      budgetPeriod,
      flexibleBudgetCents,
      actualNetSpendingCents,
      remainingBudgetCents,
      mealBudgetCents: flexibleBudgetCents,
      mealUsedCents: actualNetSpendingCents,
      mealRemainingCents: remainingBudgetCents,
      remainingDays: daily.remainingDays,
      recommendedDailyBudgetCents: daily.dailyBudgetCents,
      recommendedDailyBudgetStatus: daily.status,
      recommendedLunchPriceCents: settings.recommendedLunchPriceCents,
      lunchHardLimitCents: settings.lunchHardLimitCents,
      savingsTarget: { status: settings.monthlySavingsTargetCents > 0 ? "CONFIGURED" : "NOT_CONFIGURED", targetCents: settings.monthlySavingsTargetCents },
    });
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "FINANCIAL_CONTEXT_ERROR", error instanceof Error ? error.message : "读取财务上下文失败");
  }
}
