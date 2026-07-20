import { describe, expect, it } from "vitest";

import type { TransactionCategory, TransactionType } from "./budget";
import { groupTransactions, sortGroupedTransactions, type GroupableTransaction } from "./transaction-grouping";

function transaction(overrides: Partial<GroupableTransaction> & { id: string }): GroupableTransaction {
  return {
    id: overrides.id,
    type: (overrides.type ?? "EXPENSE") as TransactionType,
    category: ("category" in overrides ? overrides.category : "MEAL") as TransactionCategory | null,
    amountCents: overrides.amountCents ?? 1_000,
    itemName: overrides.itemName ?? overrides.id,
    merchant: overrides.merchant ?? null,
    occurredAt: overrides.occurredAt ?? "2026-07-01T12:00:00.000Z",
    isFixedExpense: overrides.isFixedExpense ?? false,
  };
}

describe("transaction grouping", () => {
  it("groups by category, calculates net spending, and orders categories by net amount", () => {
    const groups = groupTransactions([
      transaction({ id: "meal", category: "MEAL", amountCents: 2_000 }),
      transaction({ id: "transport", category: "TRANSPORT", amountCents: 3_000 }),
      transaction({ id: "refund", type: "REFUND", category: "TRANSPORT", amountCents: 500 }),
      transaction({ id: "income", type: "INCOME", category: null, amountCents: 10_000 }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["TRANSPORT", "MEAL", "INCOME"]);
    expect(groups[0]).toMatchObject({ expenseCents: 3_000, refundCents: 500, netCents: 2_500 });
    expect(groups[2]).toMatchObject({ incomeCents: 10_000, netCents: 10_000 });
  });

  it("defaults to amount descending within each category", () => {
    const [group] = groupTransactions([
      transaction({ id: "small", amountCents: 500 }),
      transaction({ id: "large", amountCents: 2_000 }),
    ]);

    expect(group.items.map((item) => item.id)).toEqual(["large", "small"]);
  });

  it("supports independent time and fixed-expense sorting", () => {
    const items = [
      transaction({ id: "new", occurredAt: "2026-07-20T12:00:00.000Z" }),
      transaction({ id: "fixed", occurredAt: "2026-07-01T12:00:00.000Z", isFixedExpense: true, amountCents: 200 }),
    ];

    expect(sortGroupedTransactions(items, "TIME_ASC").map((item) => item.id)).toEqual(["fixed", "new"]);
    expect(sortGroupedTransactions(items, "FIXED_FIRST").map((item) => item.id)).toEqual(["fixed", "new"]);
  });

  it("supports merchant sorting without mutating the source array", () => {
    const items = [transaction({ id: "b", merchant: "中山店" }), transaction({ id: "a", merchant: "阿里商店" })];
    const sorted = sortGroupedTransactions(items, "MERCHANT_ASC");

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
