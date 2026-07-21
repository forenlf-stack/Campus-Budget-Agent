export interface BudgetForecast {
  dailyAvailableCents: number;
  projectedMonthEndSpendingCents: number;
  projectedRemainingCents: number;
  remainingDays: number;
  status: "ON_TRACK" | "WARNING" | "OVER_BUDGET";
}

export function calculateBudgetForecast(input: {
  budgetCents: number;
  spentCents: number;
  periodStart: Date;
  periodEnd: Date;
  now?: Date;
}): BudgetForecast {
  const now = input.now ?? new Date();
  const dayMs = 86_400_000;
  const totalDays = Math.max(1, Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / dayMs));
  const beforePeriod = now < input.periodStart;
  const afterPeriod = now >= input.periodEnd;
  const elapsedDays = beforePeriod ? 0 : afterPeriod ? totalDays : Math.max(1, (now.getTime() - input.periodStart.getTime()) / dayMs);
  const remainingDays = beforePeriod ? totalDays : afterPeriod ? 0 : Math.max(1, Math.ceil((input.periodEnd.getTime() - now.getTime()) / dayMs));
  const remainingCents = input.budgetCents - input.spentCents;
  const projectedMonthEndSpendingCents = beforePeriod
    ? input.spentCents
    : afterPeriod
      ? input.spentCents
      : Math.max(0, Math.round((input.spentCents / elapsedDays) * totalDays));
  const projectedRemainingCents = input.budgetCents - projectedMonthEndSpendingCents;
  const ratio = input.budgetCents > 0 ? projectedMonthEndSpendingCents / input.budgetCents : projectedMonthEndSpendingCents > 0 ? Infinity : 0;
  return {
    dailyAvailableCents: remainingDays > 0 ? Math.floor(Math.max(0, remainingCents) / remainingDays) : 0,
    projectedMonthEndSpendingCents,
    projectedRemainingCents,
    remainingDays,
    status: ratio > 1 ? "OVER_BUDGET" : ratio >= 0.9 ? "WARNING" : "ON_TRACK",
  };
}
