import { describe, expect, it } from "vitest";

import { transactionInputSchema, transactionQuerySchema } from "./transactions";

const validExpense = {
  type: "EXPENSE" as const,
  amountCents: 1_300,
  category: "MEAL" as const,
  itemName: "食堂午餐",
  merchant: "第一食堂",
  occurredAt: "2026-07-14T04:00:00.000Z",
  note: "",
  isFixedExpense: false,
  originalTransactionId: null,
};

describe("消费记录校验", () => {
  it("接受正金额支出", () => {
    expect(transactionInputSchema.parse(validExpense).amountCents).toBe(1_300);
  });

  it("拒绝零金额和负金额", () => {
    expect(transactionInputSchema.safeParse({ ...validExpense, amountCents: 0 }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...validExpense, amountCents: -1_000 }).success).toBe(false);
  });

  it("拒绝小数分金额", () => {
    expect(transactionInputSchema.safeParse({ ...validExpense, amountCents: 1.5 }).success).toBe(false);
  });

  it("支出必须选择分类", () => {
    expect(transactionInputSchema.safeParse({ ...validExpense, category: null }).success).toBe(false);
  });

  it("收入不能选择分类或标记固定支出", () => {
    expect(transactionInputSchema.safeParse({ ...validExpense, type: "INCOME", category: "MEAL" }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...validExpense, type: "INCOME", category: null, isFixedExpense: true }).success).toBe(false);
  });

  it("退款必须关联原支出", () => {
    expect(transactionInputSchema.safeParse({ ...validExpense, type: "REFUND", originalTransactionId: null }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...validExpense, type: "REFUND", originalTransactionId: "tx-original" }).success).toBe(true);
  });

  it("接受预算周期、分类和类型筛选", () => {
    expect(transactionQuerySchema.parse({ period: "2026-07", category: "MEAL", type: "EXPENSE" })).toEqual({ period: "2026-07", category: "MEAL", type: "EXPENSE" });
  });
});
