import { z } from "zod";

import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { skillReadStore, type MealTransaction, type SkillReadStore } from "@/server/skill-read-store";

export const historicalMealPatternsInputSchema = z.object({
  queryDate: z.date().refine((date) => Number.isFinite(date.getTime()), "查询日期无效"),
  recentDays: z.number().int().min(1).max(90).default(30),
  lookbackDays: z.number().int().min(1).max(365).default(90),
  maximumOccurrences: z.number().int().min(1).max(10).default(2),
  maximumResults: z.number().int().min(1).max(10).default(6),
}).refine((value) => value.lookbackDays >= value.recentDays, {
  message: "统计周期不能短于近期周期",
  path: ["lookbackDays"],
});

export interface HistoricalMealPattern {
  name: string;
  merchant: string | null;
  occurrenceCount: number;
  averageNetAmountCents: number;
  lastOccurredAt: Date;
}

export interface HistoricalMealPatternsData {
  recentDays: number;
  lookbackDays: number;
  consideredMealCount: number;
  insufficientHistory: boolean;
  patterns: HistoricalMealPattern[];
}

const genericItemName = /^(?:早餐|午餐|晚餐|正餐|餐饮|餐费|用餐|商户消费|美团收银|扫码付款|付款|消费|门店消费|外卖)$/i;

function normalized(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function informativeItemName(value: string) {
  const text = value.trim();
  return Boolean(text) && !genericItemName.test(text) && !/^\d{8,}$/.test(text);
}

function mealIdentity(item: MealTransaction) {
  const merchant = normalized(item.merchant);
  const itemName = informativeItemName(item.itemName) ? normalized(item.itemName) : "";
  return merchant ? `merchant:${merchant}|item:${itemName}` : `item:${normalized(item.itemName)}`;
}

function displayName(item: MealTransaction) {
  if (informativeItemName(item.itemName)) return item.itemName.trim();
  return item.merchant?.trim() || item.itemName.trim();
}

function safeAverage(total: bigint, count: number) {
  const value = Number(total / BigInt(count));
  if (!Number.isSafeInteger(value)) throw new RangeError("历史餐食金额超出安全整数范围");
  return value;
}

export function retrieveHistoricalMealPatterns(
  input: unknown,
  store: SkillReadStore = skillReadStore,
): SkillResult<HistoricalMealPatternsData> {
  try {
    const parsed = historicalMealPatternsInputSchema.parse(input);
    const lookbackStart = new Date(parsed.queryDate.getTime() - parsed.lookbackDays * 86_400_000);
    const recentStart = new Date(parsed.queryDate.getTime() - parsed.recentDays * 86_400_000);
    const transactions = store.readMealTransactions(lookbackStart, parsed.queryDate);
    const refundedByOriginal = new Map<string, bigint>();
    for (const transaction of transactions) {
      if (transaction.type !== "REFUND" || !transaction.originalTransactionId) continue;
      refundedByOriginal.set(
        transaction.originalTransactionId,
        (refundedByOriginal.get(transaction.originalTransactionId) ?? BigInt(0)) + BigInt(transaction.amountCents),
      );
    }

    const effectiveMeals = transactions.flatMap((transaction) => {
      if (transaction.type !== "EXPENSE" || transaction.isFixedExpense) return [];
      const refundedCents = refundedByOriginal.get(transaction.id) ?? BigInt(0);
      const netCents = BigInt(transaction.amountCents) - refundedCents;
      if (netCents <= 0) return [];
      const amountCents = Number(netCents);
      if (!Number.isSafeInteger(amountCents)) throw new RangeError("历史餐食净额超出安全整数范围");
      return [{ transaction, amountCents }];
    });

    const grouped = new Map<string, {
      name: string;
      merchant: string | null;
      occurrenceCount: number;
      totalNetAmountCents: bigint;
      lastOccurredAt: Date;
    }>();
    for (const { transaction, amountCents } of effectiveMeals) {
      const key = mealIdentity(transaction);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          name: displayName(transaction),
          merchant: transaction.merchant?.trim() || null,
          occurrenceCount: 1,
          totalNetAmountCents: BigInt(amountCents),
          lastOccurredAt: transaction.occurredAt,
        });
        continue;
      }
      current.occurrenceCount += 1;
      current.totalNetAmountCents += BigInt(amountCents);
      if (transaction.occurredAt > current.lastOccurredAt) {
        current.lastOccurredAt = transaction.occurredAt;
        current.name = displayName(transaction);
        current.merchant = transaction.merchant?.trim() || null;
      }
    }

    const patterns = [...grouped.values()]
      .filter((item) => item.lastOccurredAt >= recentStart && item.occurrenceCount <= parsed.maximumOccurrences)
      .sort((left, right) => right.lastOccurredAt.getTime() - left.lastOccurredAt.getTime()
        || left.occurrenceCount - right.occurrenceCount
        || left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, parsed.maximumResults)
      .map((item): HistoricalMealPattern => ({
        name: item.name,
        merchant: item.merchant,
        occurrenceCount: item.occurrenceCount,
        averageNetAmountCents: safeAverage(item.totalNetAmountCents, item.occurrenceCount),
        lastOccurredAt: item.lastOccurredAt,
      }));

    return skillSuccess({
      recentDays: parsed.recentDays,
      lookbackDays: parsed.lookbackDays,
      consideredMealCount: effectiveMeals.length,
      insufficientHistory: effectiveMeals.length < 10,
      patterns,
    });
  } catch (error) {
    return skillFailure(
      error instanceof z.ZodError ? "INVALID_INPUT" : "HISTORICAL_MEAL_PATTERN_ERROR",
      error instanceof Error ? error.message : "读取历史餐食规律失败",
    );
  }
}
