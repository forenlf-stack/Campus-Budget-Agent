import { z } from "zod";

import { snackDecisionInputSchema, snackDecisionResponseSchema, type SnackDecisionResponse } from "@/lib/snack-decisions";
import { shanghaiPeriodForDate } from "@/lib/period";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";
import { getFinancialContext } from "./get-financial-context";

function sum(values: number[]) {
  const value = Number(values.reduce((total, item) => total + BigInt(item), BigInt(0)));
  if (!Number.isSafeInteger(value)) throw new RangeError("金额计算结果超出安全整数范围");
  return value;
}

export function evaluateSnackPurchase(input: unknown, store: SkillReadStore = skillReadStore): SkillResult<SnackDecisionResponse> {
  try {
    const parsed = snackDecisionInputSchema.parse(input);
    const occurredAt = new Date(parsed.occurredAt);
    const financial = getFinancialContext({ queryDate: occurredAt, budgetPeriod: shanghaiPeriodForDate(occurredAt) }, store);
    if (!financial.success) return financial;
    const settings = store.readSettings(financial.data.budgetPeriod);
    const sevenDaysAgo = new Date(occurredAt.getTime() - 7 * 86_400_000);
    const fourteenDaysAgo = new Date(occurredAt.getTime() - 14 * 86_400_000);
    const todayStart = new Date(occurredAt);
    todayStart.setHours(0, 0, 0, 0);
    const allRecent = store.readPeriodTransactions(fourteenDaysAgo, occurredAt);
    const expenses = allRecent
      .filter((item) => item.category === "SNACK_DRINK" && item.type === "EXPENSE" && !item.isFixedExpense);
    const refunds = allRecent.filter((item) => item.category === "SNACK_DRINK" && item.type === "REFUND" && !item.isFixedExpense);
    const currentExpenses = expenses.filter((item) => item.occurredAt >= sevenDaysAgo);
    const previousExpenses = expenses.filter((item) => item.occurredAt < sevenDaysAgo);
    const currentRefunds = refunds.filter((item) => item.occurredAt >= sevenDaysAgo);
    const previousRefunds = refunds.filter((item) => item.occurredAt < sevenDaysAgo);
    const recentCount = currentExpenses.length;
    const recentSpendingCents = Math.max(sum(currentExpenses.map((item) => item.amountCents)) - sum(currentRefunds.map((item) => item.amountCents)), 0);
    const previousWeekCount = previousExpenses.length;
    const previousWeekSpendingCents = Math.max(sum(previousExpenses.map((item) => item.amountCents)) - sum(previousRefunds.map((item) => item.amountCents)), 0);
    const recentAveragePriceCents = recentCount > 0 ? Math.round(recentSpendingCents / recentCount) : 0;
    const todayCount = currentExpenses.filter((item) => item.occurredAt >= todayStart).length;
    const remainingBudgetAfterCents = financial.data.remainingBudgetCents - parsed.priceCents;
    const exceedsFrequency = settings.weeklySnackDrinkLimit > 0 && recentCount + 1 > settings.weeklySnackDrinkLimit;
    const exceedsWeeklyAmount = settings.weeklySnackDrinkBudgetCents > 0 && recentSpendingCents + parsed.priceCents > settings.weeklySnackDrinkBudgetCents;
    const frequencyRemainingAfter = settings.weeklySnackDrinkLimit > 0 ? settings.weeklySnackDrinkLimit - recentCount - 1 : 0;
    const weeklyBudgetRemainingAfterCents = settings.weeklySnackDrinkBudgetCents > 0 ? settings.weeklySnackDrinkBudgetCents - recentSpendingCents - parsed.priceCents : 0;

    let level: SnackDecisionResponse["level"] = "GREEN";
    if (remainingBudgetAfterCents < 0 || (exceedsFrequency && exceedsWeeklyAmount)) level = "RED";
    else if (todayCount > 0 || exceedsFrequency || exceedsWeeklyAmount) level = "YELLOW";
    const recommendation = level === "GREEN" ? "BUY" : level === "YELLOW" ? "SWITCH_OR_REDUCE" : "DELAY_OR_SKIP";
    const reasons = [
      remainingBudgetAfterCents < 0 ? `购买后总预算将超支 ${(Math.abs(remainingBudgetAfterCents) / 100).toFixed(2)} 元` : `购买后总预算还剩 ${(remainingBudgetAfterCents / 100).toFixed(2)} 元`,
      `近7天已购买 ${recentCount} 次，共 ${(recentSpendingCents / 100).toFixed(2)} 元`,
      ...(todayCount > 0 ? ["今天已经购买过零食或饮料"] : []),
      ...(exceedsFrequency ? [`本次后将超过每周 ${settings.weeklySnackDrinkLimit} 次的偏好上限`] : []),
      ...(exceedsWeeklyAmount ? [`本次后将超过每周 ${(settings.weeklySnackDrinkBudgetCents / 100).toFixed(2)} 元的偏好额度`] : []),
    ].slice(0, 4);
    const alternatives = level === "GREEN" ? [] : [
      `换成不超过 ${(Math.max(100, Math.min(parsed.priceCents - 100, settings.weeklySnackDrinkBudgetCents - recentSpendingCents)) / 100).toFixed(2)} 元的选择`,
      todayCount > 0 ? "今天先不买，改到其他天" : "先等10分钟，再确认是否仍然想买",
    ];
    return skillSuccess(snackDecisionResponseSchema.parse({
      level,
      recommendation,
      title: level === "GREEN" ? "可以买" : level === "YELLOW" ? "建议换便宜一点或减少本次消费" : "建议延后或本次不买",
      reasons,
      alternatives,
      agentComment: null,
      agentSource: "RULES",
      context: {
        recentDays: 7, recentCount, recentSpendingCents, todayCount,
        weeklyLimit: settings.weeklySnackDrinkLimit,
        weeklyBudgetCents: settings.weeklySnackDrinkBudgetCents,
        previousWeekCount,
        previousWeekSpendingCents,
        recentAveragePriceCents,
        frequencyRemainingAfter,
        weeklyBudgetRemainingAfterCents,
        remainingBudgetBeforeCents: financial.data.remainingBudgetCents,
        remainingBudgetAfterCents,
      },
    }));
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "SNACK_DECISION_ERROR", error instanceof Error ? error.message : "零食饮料购买判断失败");
  }
}
