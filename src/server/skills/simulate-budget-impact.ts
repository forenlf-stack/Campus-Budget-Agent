import { z } from "zod";

import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";

const safeCents = z.number().int().safe();

export const simulateBudgetImpactInputSchema = z.object({
  candidatePriceCents: safeCents.positive(),
  financialContext: z.object({
    remainingBudgetCents: safeCents,
    mealRemainingCents: safeCents,
    remainingDays: z.number().int().nonnegative(),
    recommendedLunchPriceCents: safeCents.nonnegative(),
    lunchHardLimitCents: safeCents.nonnegative(),
    savingsTarget: z.object({ status: z.enum(["CONFIGURED", "NOT_CONFIGURED"]), targetCents: safeCents.nonnegative() }),
  }).passthrough(),
});

export interface BudgetImpactData {
  remainingBudgetAfterCents: number;
  mealRemainingAfterCents: number;
  exceedsRecommendedPrice: boolean;
  exceedsHardLimit: boolean;
  causesMealBudgetOverrun: boolean;
  recommendedDailyBudgetAfterCents: number;
  recommendedDailyBudgetAfterStatus: "AVAILABLE" | "NO_REMAINING_BUDGET" | "PERIOD_ENDED";
  savingsTargetStillOnTrack: boolean;
}

export function simulateBudgetImpact(input: unknown): SkillResult<BudgetImpactData> {
  try {
    const parsed = simulateBudgetImpactInputSchema.parse(input);
    const remainingBudgetAfterCents = Number(BigInt(parsed.financialContext.remainingBudgetCents) - BigInt(parsed.candidatePriceCents));
    const mealRemainingAfterCents = remainingBudgetAfterCents;
    if (!Number.isSafeInteger(remainingBudgetAfterCents) || !Number.isSafeInteger(mealRemainingAfterCents)) throw new RangeError("金额计算结果超出安全整数范围");
    const periodEnded = parsed.financialContext.remainingDays <= 0;
    const noBudget = remainingBudgetAfterCents <= 0;
    return skillSuccess({
      remainingBudgetAfterCents,
      mealRemainingAfterCents,
      exceedsRecommendedPrice: parsed.candidatePriceCents > parsed.financialContext.recommendedLunchPriceCents,
      exceedsHardLimit: parsed.candidatePriceCents > parsed.financialContext.lunchHardLimitCents,
      causesMealBudgetOverrun: false,
      recommendedDailyBudgetAfterCents: periodEnded || noBudget ? 0 : Math.floor(remainingBudgetAfterCents / parsed.financialContext.remainingDays),
      recommendedDailyBudgetAfterStatus: periodEnded ? "PERIOD_ENDED" : noBudget ? "NO_REMAINING_BUDGET" : "AVAILABLE",
      savingsTargetStillOnTrack: parsed.financialContext.savingsTarget.status === "NOT_CONFIGURED" || remainingBudgetAfterCents >= 0,
    });
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "BUDGET_SIMULATION_ERROR", error instanceof Error ? error.message : "预算影响模拟失败");
  }
}
