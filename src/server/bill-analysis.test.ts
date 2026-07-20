import { describe, expect, it } from "vitest";

import type { TransactionRecord } from "@/server/transaction-store";
import { buildBillAnalysis } from "./bill-analysis";

function transaction(overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    id: "id", type: "EXPENSE", category: "MEAL", amountCents: 1_000, itemName: "午餐", merchant: null,
    occurredAt: "2026-07-16T04:00:00.000Z", note: null, isFixedExpense: false, originalTransactionId: null,
    ...overrides,
  };
}

describe("buildBillAnalysis", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");

  it("按等长周期比较最近3天并抵扣退款", () => {
    const result = buildBillAnalysis([
      transaction({ id: "current", amountCents: 3_000, occurredAt: "2026-07-16T04:00:00.000Z" }),
      transaction({ id: "refund", type: "REFUND", amountCents: 500, occurredAt: "2026-07-16T06:00:00.000Z" }),
      transaction({ id: "previous", amountCents: 1_000, occurredAt: "2026-07-13T04:00:00.000Z" }),
    ], now);
    const window = result.windows.find((item) => item.key === "DAYS_3");
    expect(window).toMatchObject({ currentSpendingCents: 2_500, previousSpendingCents: 1_000, changeCents: 1_500, changePercent: 150 });
  });

  it("保留当期支出下降时的负变化额", () => {
    const result = buildBillAnalysis([
      transaction({ id: "current", amountCents: 1_000, occurredAt: "2026-07-16T04:00:00.000Z" }),
      transaction({ id: "previous", amountCents: 3_000, occurredAt: "2026-07-13T04:00:00.000Z" }),
    ], now);

    const window = result.windows.find((item) => item.key === "DAYS_3");
    expect(window).toMatchObject({
      currentSpendingCents: 1_000,
      previousSpendingCents: 3_000,
      changeCents: -2_000,
      changePercent: -66.67,
    });
  });

  it("计算分类占比和最高支出日期", () => {
    const result = buildBillAnalysis([
      transaction({ id: "meal", amountCents: 3_000, category: "MEAL", occurredAt: "2026-07-16T04:00:00.000Z" }),
      transaction({ id: "study", amountCents: 1_000, category: "STUDY", occurredAt: "2026-07-15T10:00:00.000Z" }),
    ], now);
    expect(result.summary.topCategories[0]).toMatchObject({ category: "MEAL", amountCents: 3_000, sharePercent: 75 });
    expect(result.summary.highestSpendingDays[0]).toMatchObject({ amountCents: 3_000 });
  });

  it("将关联退款合并到原支出事件的日期和时段", () => {
    const result = buildBillAnalysis([
      transaction({ id: "medical", category: "MEDICAL", amountCents: 999_900, occurredAt: "2026-07-17T02:18:00.000Z" }),
      transaction({ id: "refund-1", type: "REFUND", category: "MEDICAL", amountCents: 50_000, originalTransactionId: "medical", occurredAt: "2026-07-17T02:18:00.000Z" }),
      transaction({ id: "refund-2", type: "REFUND", category: "MEDICAL", amountCents: 945_000, originalTransactionId: "medical", occurredAt: "2026-07-17T12:57:00.000Z" }),
    ], now);

    expect(result.summary.totalSpendingCents).toBe(4_900);
    expect(result.summary.topCategories[0]).toMatchObject({ category: "MEDICAL", amountCents: 4_900 });
    expect(result.summary.highestSpendingPeriods).toEqual([{ label: "上午", amountCents: 4_900 }]);
  });
});
