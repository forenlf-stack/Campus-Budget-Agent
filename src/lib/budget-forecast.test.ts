import { describe, expect, it } from "vitest";

import { calculateBudgetForecast } from "./budget-forecast";

describe("calculateBudgetForecast", () => {
  it("predicts month-end spending and daily allowance", () => {
    const result = calculateBudgetForecast({
      budgetCents: 310_000,
      spentCents: 100_000,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
    expect(result.projectedMonthEndSpendingCents).toBe(310_000);
    expect(result.dailyAvailableCents).toBe(10_000);
    expect(result.status).toBe("WARNING");
  });

  it("marks projected overspending", () => {
    const result = calculateBudgetForecast({
      budgetCents: 300_000,
      spentCents: 160_000,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(result.status).toBe("OVER_BUDGET");
    expect(result.projectedRemainingCents).toBeLessThan(0);
  });
});
