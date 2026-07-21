import { describe, expect, it } from "vitest";

import type { SettingsInput } from "@/lib/settings";
import type { MealTransaction, SkillReadStore } from "@/server/skill-read-store";
import { retrieveHistoricalMealPatterns } from "./retrieve-historical-meal-patterns";

const queryDate = new Date("2026-07-21T12:00:00+08:00");
const settings = {} as SettingsInput;

function meal(id: string, overrides: Partial<MealTransaction> = {}): MealTransaction {
  return {
    id,
    type: "EXPENSE",
    category: "MEAL",
    amountCents: 1_500,
    occurredAt: new Date("2026-07-18T12:00:00+08:00"),
    isFixedExpense: false,
    itemName: "鸡腿饭",
    merchant: "第一食堂",
    originalTransactionId: null,
    ...overrides,
  };
}

function store(transactions: MealTransaction[]): SkillReadStore {
  return {
    readSettings: () => settings,
    readPeriodTransactions: () => [],
    readMealTransactions: () => transactions,
    readMealCandidates: () => [],
  };
}

describe("retrieveHistoricalMealPatterns", () => {
  it("列出近期吃过且90天内不超过2次的低频餐食", () => {
    const result = retrieveHistoricalMealPatterns({ queryDate }, store([
      meal("rare", { itemName: "咖喱鸡肉饭", merchant: "中心美食广场" }),
      meal("common-1", { itemName: "鸡腿饭" }),
      meal("common-2", { itemName: "鸡腿饭", occurredAt: new Date("2026-07-10T12:00:00+08:00") }),
      meal("common-3", { itemName: "鸡腿饭", occurredAt: new Date("2026-06-20T12:00:00+08:00") }),
    ]));
    expect(result).toMatchObject({ success: true, data: { patterns: [{ name: "咖喱鸡肉饭", occurrenceCount: 1 }] } });
  });

  it("全额退款不进入结果，部分退款按净额计算", () => {
    const result = retrieveHistoricalMealPatterns({ queryDate }, store([
      meal("full", { itemName: "全退餐", amountCents: 2_000 }),
      meal("refund-full", { type: "REFUND", itemName: "全退餐退款", amountCents: 2_000, originalTransactionId: "full" }),
      meal("partial", { itemName: "部分退款餐", amountCents: 2_000 }),
      meal("refund-partial", { type: "REFUND", itemName: "部分退款", amountCents: 500, originalTransactionId: "partial" }),
    ]));
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.patterns.map((item) => item.name)).not.toContain("全退餐");
    expect(result.data.patterns.find((item) => item.name === "部分退款餐")?.averageNetAmountCents).toBe(1_500);
  });

  it("泛化项目名使用商家展示并排除固定支出", () => {
    const result = retrieveHistoricalMealPatterns({ queryDate }, store([
      meal("generic", { itemName: "美团收银", merchant: "西塔婆婆生蚝烤肉自助" }),
      meal("fixed", { itemName: "食堂月卡", merchant: "第一食堂", isFixedExpense: true }),
    ]));
    expect(result).toMatchObject({ success: true, data: { patterns: [{ name: "西塔婆婆生蚝烤肉自助" }] } });
  });

  it("拒绝统计周期短于近期周期", () => {
    expect(retrieveHistoricalMealPatterns({ queryDate, recentDays: 30, lookbackDays: 20 }, store([])))
      .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
