import { z } from "zod";

import { shanghaiPeriodForDate } from "@/lib/period";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { skillReadStore, type MealTransaction, type SkillReadStore } from "@/server/skill-read-store";

export const recentMealConsumptionInputSchema = z.object({
  queryDate: z.date().refine((date) => Number.isFinite(date.getTime()), "查询日期无效"),
  days: z.number().int().min(1).max(90).default(7),
  recentCount: z.number().int().min(1).max(30).default(3),
});

export interface RecentMealConsumptionData {
  days: number;
  mealCount: number;
  totalCents: number;
  averagePriceCents: number;
  recentMeals: Array<{ id: string; name: string; merchant: string | null; amountCents: number; occurredAt: Date }>;
  recentAveragePriceCents: number;
  recentMealNames: string[];
  highRecentPriceTriggered: boolean;
  highPriceEvidence: { thresholdCents: number; recentAveragePriceCents: number; comparedMealCount: number; rule: "RECENT_AVERAGE_ABOVE_120_PERCENT_RECOMMENDED_LUNCH_PRICE" };
}

function sum(values: number[]) {
  const result = Number(values.reduce((total, value) => total + BigInt(value), BigInt(0)));
  if (!Number.isSafeInteger(result)) throw new RangeError("金额计算结果超出安全整数范围");
  return result;
}

function average(transactions: MealTransaction[]) {
  return transactions.length ? Math.floor(sum(transactions.map((item) => item.amountCents)) / transactions.length) : 0;
}

export function getRecentMealConsumption(input: unknown, store: SkillReadStore = skillReadStore): SkillResult<RecentMealConsumptionData> {
  try {
    const parsed = recentMealConsumptionInputSchema.parse(input);
    const start = new Date(parsed.queryDate.getTime() - parsed.days * 86_400_000);
    const transactions = store.readMealTransactions(start, parsed.queryDate).filter((item) => item.type === "EXPENSE" && !item.isFixedExpense);
    const recentMeals = transactions.slice(0, parsed.recentCount);
    const totalCents = sum(transactions.map((item) => item.amountCents));
    const recentAveragePriceCents = average(recentMeals);
    const recommendedPriceCents = store.readSettings(shanghaiPeriodForDate(parsed.queryDate)).recommendedLunchPriceCents;
    const thresholdCents = Math.floor((recommendedPriceCents * 120) / 100);
    return skillSuccess({
      days: parsed.days,
      mealCount: transactions.length,
      totalCents,
      averagePriceCents: transactions.length ? Math.floor(totalCents / transactions.length) : 0,
      recentMeals: recentMeals.map((item) => ({ id: item.id, name: item.itemName, merchant: item.merchant, amountCents: item.amountCents, occurredAt: item.occurredAt })),
      recentAveragePriceCents,
      recentMealNames: [...new Set(recentMeals.map((item) => item.itemName))],
      highRecentPriceTriggered: recentMeals.length >= 3 && sum(recentMeals.map((item) => item.amountCents)) * 100 > recommendedPriceCents * 120 * recentMeals.length,
      highPriceEvidence: { thresholdCents, recentAveragePriceCents, comparedMealCount: recentMeals.length, rule: "RECENT_AVERAGE_ABOVE_120_PERCENT_RECOMMENDED_LUNCH_PRICE" },
    });
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "RECENT_MEAL_ERROR", error instanceof Error ? error.message : "读取近期正餐消费失败");
  }
}
