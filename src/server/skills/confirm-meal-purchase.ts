import { confirmMealDecisionInputSchema, confirmMealDecisionResponseSchema, type ConfirmMealDecisionResponse } from "@/lib/meal-decisions";
import { shanghaiPeriodForDate } from "@/lib/period";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { recordPurchasedMealDecision, type RecordedMealDecision } from "@/server/meal-decision-store";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";
import { getFinancialContext } from "./get-financial-context";
import { simulateBudgetImpact, type BudgetImpactData } from "./simulate-budget-impact";

export interface ConfirmMealPurchaseDependencies {
  store: SkillReadStore;
  getFinancialContext: typeof getFinancialContext;
  simulateBudgetImpact: typeof simulateBudgetImpact;
  recordPurchasedMealDecision: (userId: string, input: ReturnType<typeof confirmMealDecisionInputSchema.parse>, impact: BudgetImpactData) => RecordedMealDecision;
}

const defaultDependencies: ConfirmMealPurchaseDependencies = {
  store: skillReadStore,
  getFinancialContext,
  simulateBudgetImpact,
  recordPurchasedMealDecision,
};

export function confirmMealPurchase(
  userId: string,
  input: unknown,
  dependencyOverrides: Partial<ConfirmMealPurchaseDependencies> = {},
): SkillResult<ConfirmMealDecisionResponse> {
  try {
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const parsed = confirmMealDecisionInputSchema.parse(input);
    const occurredAt = new Date(parsed.occurredAt);
    const financial = dependencies.getFinancialContext({ queryDate: occurredAt, budgetPeriod: shanghaiPeriodForDate(occurredAt) }, dependencies.store);
    if (!financial.success) return financial;
    const impact = dependencies.simulateBudgetImpact({ candidatePriceCents: parsed.actualPriceCents, financialContext: financial.data });
    if (!impact.success) return impact;
    const recorded = dependencies.recordPurchasedMealDecision(userId, parsed, impact.data);
    const budgetAfter = recorded.idempotent
      ? {
          remainingBudgetCents: recorded.budgetImpact.remainingBudgetAfterCents,
          mealRemainingCents: recorded.budgetImpact.mealRemainingAfterCents,
          recommendedDailyBudgetCents: recorded.budgetImpact.recommendedDailyBudgetAfterCents,
        }
      : (() => {
          const updated = dependencies.getFinancialContext({ queryDate: occurredAt, budgetPeriod: shanghaiPeriodForDate(occurredAt) }, dependencies.store);
          if (!updated.success) throw new Error(updated.error.message);
          return {
            remainingBudgetCents: updated.data.remainingBudgetCents,
            mealRemainingCents: updated.data.mealRemainingCents,
            recommendedDailyBudgetCents: updated.data.recommendedDailyBudgetCents,
          };
        })();
    return skillSuccess(confirmMealDecisionResponseSchema.parse({ ...recorded, budgetAfter }));
  } catch (error) {
    return skillFailure("CONFIRM_MEAL_PURCHASE_ERROR", error instanceof Error ? error.message : "确认餐食消费失败");
  }
}
