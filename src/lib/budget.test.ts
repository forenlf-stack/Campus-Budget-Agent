import { describe, expect, it } from "vitest";

import {
  calculateBudgetStatus,
  calculateCategoryUsage,
  calculateFlexibleBudget,
  calculateNetVariableSpending,
  calculatePeriodIncome,
  calculateRecommendedDailyBudget,
  calculateRemainingBudget,
  type BudgetTransaction,
} from "./budget";

const periodStart = new Date("2026-07-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-01T00:00:00.000Z");

function transaction(overrides: Partial<BudgetTransaction> = {}): BudgetTransaction {
  return {
    id: "tx-1",
    type: "EXPENSE",
    category: "MEAL",
    amountCents: 1_000,
    occurredAt: new Date("2026-07-10T00:00:00.000Z"),
    isFixedExpense: false,
    ...overrides,
  };
}

describe("预算计算模块", () => {
  it("计算周期内的多笔收入", () => {
    const result = calculatePeriodIncome({
      transactions: [
        transaction({ id: "income-1", type: "INCOME", category: null, amountCents: 100_000 }),
        transaction({ id: "income-2", type: "INCOME", category: null, amountCents: 20_000 }),
        transaction({ id: "expense", amountCents: 5_000 }),
      ],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(120_000);
  });

  it("空交易的收入和净支出均为零", () => {
    const input = { transactions: [], periodStart, periodEnd };

    expect(calculatePeriodIncome(input)).toBe(0);
    expect(calculateNetVariableSpending(input)).toBe(0);
  });

  it("支出增加实际可变净支出", () => {
    const result = calculateNetVariableSpending({ transactions: [transaction({ amountCents: 2_500 })], periodStart, periodEnd });

    expect(result).toBe(2_500);
  });

  it("退款从普通可变支出扣除", () => {
    const result = calculateNetVariableSpending({
      transactions: [transaction({ amountCents: 3_000 }), transaction({ id: "refund", type: "REFUND", amountCents: 800 })],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(2_200);
  });

  it("固定支出及固定支出退款不计入可变支出", () => {
    const result = calculateNetVariableSpending({
      transactions: [
        transaction({ id: "fixed", amountCents: 4_000, isFixedExpense: true }),
        transaction({ id: "fixed-refund", type: "REFUND", amountCents: 1_000, isFixedExpense: true }),
        transaction({ id: "variable", amountCents: 1_500 }),
      ],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(1_500);
  });

  it("退款超过可变消费时净支出下限为零", () => {
    const result = calculateNetVariableSpending({
      transactions: [transaction(), transaction({ id: "refund", type: "REFUND", amountCents: 1_500 })],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(0);
  });

  it("忽略周期之外的交易并采用左闭右开边界", () => {
    const result = calculatePeriodIncome({
      transactions: [
        transaction({ id: "before", type: "INCOME", category: null, occurredAt: new Date("2026-06-30T23:59:59.999Z") }),
        transaction({ id: "start", type: "INCOME", category: null, occurredAt: periodStart, amountCents: 2_000 }),
        transaction({ id: "end", type: "INCOME", category: null, occurredAt: periodEnd, amountCents: 4_000 }),
      ],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(2_000);
  });

  it("计算可变消费总额度", () => {
    expect(calculateFlexibleBudget({
      periodIncomeCents: 200_000,
      plannedFixedExpensesCents: 50_000,
      plannedSavingsCents: 30_000,
      requiredReserveCents: 20_000,
    })).toBe(100_000);
  });

  it("配置不可行时可变额度为负并判定无效", () => {
    const flexibleBudgetCents = calculateFlexibleBudget({
      periodIncomeCents: 50_000,
      plannedFixedExpensesCents: 40_000,
      plannedSavingsCents: 20_000,
      requiredReserveCents: 5_000,
    });

    expect(flexibleBudgetCents).toBe(-15_000);
    expect(calculateBudgetStatus({ flexibleBudgetCents, plannedVariableBudgetCents: 0, actualNetVariableSpendingCents: 0, categoryBudgets: [] })).toBe("INVALID_PLAN");
  });

  it("计算剩余预算且允许负数表示超支", () => {
    expect(calculateRemainingBudget({ plannedVariableBudgetCents: 10_000, actualNetVariableSpendingCents: 12_000 })).toBe(-2_000);
  });

  it("推荐日预算使用向下取整", () => {
    const result = calculateRecommendedDailyBudget({
      remainingBudgetCents: 1_001,
      currentDate: new Date("2026-07-29T00:00:00.000Z"),
      periodEnd,
    });

    expect(result).toEqual({ dailyBudgetCents: 333, remainingDays: 3, status: "AVAILABLE", rounding: "FLOOR" });
  });

  it("剩余预算为负时日预算返回零", () => {
    const result = calculateRecommendedDailyBudget({ remainingBudgetCents: -1, currentDate: periodStart, periodEnd });

    expect(result.dailyBudgetCents).toBe(0);
    expect(result.status).toBe("NO_REMAINING_BUDGET");
  });

  it("剩余天数为零时返回明确状态", () => {
    const result = calculateRecommendedDailyBudget({ remainingBudgetCents: 1_000, currentDate: periodEnd, periodEnd });

    expect(result).toEqual({ dailyBudgetCents: 0, remainingDays: 0, status: "PERIOD_ENDED", rounding: "FLOOR" });
  });

  it("分类用量分别返回消费、退款、净支出、余额和基点使用率", () => {
    const [usage] = calculateCategoryUsage({
      transactions: [transaction({ amountCents: 3_000 }), transaction({ id: "refund", type: "REFUND", amountCents: 500 })],
      periodStart,
      periodEnd,
      categoryBudgets: [{ category: "MEAL", budgetCents: 10_000 }],
    });

    expect(usage).toEqual({
      category: "MEAL",
      budgetCents: 10_000,
      spentCents: 3_000,
      refundedCents: 500,
      netSpendingCents: 2_500,
      remainingCents: 7_500,
      usageBasisPoints: 2_500,
    });
  });

  it("零分类预算的使用率返回 null", () => {
    const [usage] = calculateCategoryUsage({ transactions: [], periodStart, periodEnd, categoryBudgets: [{ category: "OTHER", budgetCents: 0 }] });

    expect(usage.usageBasisPoints).toBeNull();
  });

  it("状态覆盖健康、警告和超支", () => {
    const base = { flexibleBudgetCents: 10_000, plannedVariableBudgetCents: 10_000, categoryBudgets: [] };

    expect(calculateBudgetStatus({ ...base, actualNetVariableSpendingCents: 7_999 })).toBe("HEALTHY");
    expect(calculateBudgetStatus({ ...base, actualNetVariableSpendingCents: 8_000 })).toBe("WARNING");
    expect(calculateBudgetStatus({ ...base, actualNetVariableSpendingCents: 10_001 })).toBe("OVER_BUDGET");
  });

  it("分类预算总和超过可变消费预算时计划无效", () => {
    const result = calculateBudgetStatus({
      flexibleBudgetCents: 20_000,
      plannedVariableBudgetCents: 10_000,
      actualNetVariableSpendingCents: 0,
      categoryBudgets: [{ category: "MEAL", budgetCents: 8_000 }, { category: "STUDY", budgetCents: 3_000 }],
    });

    expect(result).toBe("INVALID_PLAN");
  });

  it("拒绝负的配置金额", () => {
    expect(() => calculateFlexibleBudget({
      periodIncomeCents: 10_000,
      plannedFixedExpensesCents: -1,
      plannedSavingsCents: 0,
      requiredReserveCents: 0,
    })).toThrow();
  });

  it("拒绝小数金额", () => {
    expect(() => calculateRemainingBudget({ plannedVariableBudgetCents: 1_000.5, actualNetVariableSpendingCents: 0 })).toThrow();
  });

  it("拒绝 NaN 和 Infinity", () => {
    expect(() => calculateRemainingBudget({ plannedVariableBudgetCents: Number.NaN, actualNetVariableSpendingCents: 0 })).toThrow();
    expect(() => calculateRemainingBudget({ plannedVariableBudgetCents: Number.POSITIVE_INFINITY, actualNetVariableSpendingCents: 0 })).toThrow();
  });

  it("安全整数边界内可计算收入", () => {
    const result = calculatePeriodIncome({
      transactions: [transaction({ type: "INCOME", category: null, amountCents: Number.MAX_SAFE_INTEGER })],
      periodStart,
      periodEnd,
    });

    expect(result).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("累计超过安全整数边界时拒绝结果", () => {
    expect(() => calculatePeriodIncome({
      transactions: [
        transaction({ id: "income-1", type: "INCOME", category: null, amountCents: Number.MAX_SAFE_INTEGER }),
        transaction({ id: "income-2", type: "INCOME", category: null, amountCents: 1 }),
      ],
      periodStart,
      periodEnd,
    })).toThrow(RangeError);
  });
});
