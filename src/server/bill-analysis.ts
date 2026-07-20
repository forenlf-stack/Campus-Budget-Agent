import { categoryLabels } from "@/lib/settings";
import { billAnalysisWindowKeys } from "@/lib/bill-analysis";
import type { TransactionRecord } from "@/server/transaction-store";

const dayMs = 86_400_000;
const windowDays = { DAYS_3: 3, DAYS_7: 7, DAYS_30: 30, DAYS_90: 90 } as const;
const windowLabels = { DAYS_3: "最近3天", DAYS_7: "最近7天", DAYS_30: "最近30天", DAYS_90: "最近90天" } as const;

interface NetExpenseEvent {
  category: TransactionRecord["category"];
  amountCents: number;
  occurredAt: Date;
}

function netExpenseEvents(rows: TransactionRecord[]): NetExpenseEvent[] {
  const expenses = new Map(rows.filter((row) => row.type === "EXPENSE").map((row) => [row.id, { row, refundedCents: 0 }]));
  const orphanRefunds: NetExpenseEvent[] = [];
  for (const refund of rows.filter((row) => row.type === "REFUND")) {
    const original = refund.originalTransactionId ? expenses.get(refund.originalTransactionId) : undefined;
    if (original) original.refundedCents += refund.amountCents;
    else orphanRefunds.push({ category: refund.category, amountCents: -refund.amountCents, occurredAt: new Date(refund.occurredAt) });
  }
  return [
    ...[...expenses.values()].map(({ row, refundedCents }) => ({ category: row.category, amountCents: Math.max(row.amountCents - refundedCents, 0), occurredAt: new Date(row.occurredAt) })),
    ...orphanRefunds,
  ];
}

function sum(events: NetExpenseEvent[]) {
  return events.reduce((total, event) => total + event.amountCents, 0);
}

function periodLabel(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
  if (hour < 6) return "凌晨";
  if (hour < 11) return "上午";
  if (hour < 14) return "午间";
  if (hour < 18) return "下午";
  return "晚间";
}

function shanghaiDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function buildBillAnalysis(rows: TransactionRecord[], now = new Date()) {
  const events = netExpenseEvents(rows);
  const windows = billAnalysisWindowKeys.map((key) => {
    const days = windowDays[key];
    const currentStart = new Date(now.getTime() - days * dayMs);
    const previousStart = new Date(now.getTime() - days * 2 * dayMs);
    const currentEvents = events.filter((event) => event.occurredAt >= currentStart && event.occurredAt < now);
    const previousEvents = events.filter((event) => event.occurredAt >= previousStart && event.occurredAt < currentStart);
    const currentSpendingCents = sum(currentEvents);
    const previousSpendingCents = sum(previousEvents);
    const changeCents = currentSpendingCents - previousSpendingCents;
    return {
      key, label: windowLabels[key], days, currentSpendingCents, previousSpendingCents, changeCents,
      changePercent: previousSpendingCents > 0 ? Math.round((changeCents / previousSpendingCents) * 10_000) / 100 : null,
      transactionCount: currentEvents.filter((event) => event.amountCents > 0).length,
      dailyAverageCents: Math.round(currentSpendingCents / days),
    };
  });
  const recent90 = events.filter((event) => event.occurredAt >= new Date(now.getTime() - 90 * dayMs));
  const totalSpendingCents = sum(recent90);
  const categories = new Map<string, number>();
  const dates = new Map<string, number>();
  const periods = new Map<string, number>();
  for (const event of recent90) {
    const value = event.amountCents;
    if (event.category) categories.set(event.category, (categories.get(event.category) ?? 0) + value);
    const date = event.occurredAt;
    const dateKey = shanghaiDate(date);
    const timeKey = periodLabel(date);
    dates.set(dateKey, (dates.get(dateKey) ?? 0) + value);
    periods.set(timeKey, (periods.get(timeKey) ?? 0) + value);
  }
  const descending = (entries: Iterable<[string, number]>) => [...entries].filter(([, value]) => value > 0).sort((left, right) => right[1] - left[1]);
  return {
    summary: {
      totalSpendingCents,
      transactionCount: recent90.filter((event) => event.amountCents > 0).length,
      topCategories: descending(categories.entries()).slice(0, 5).map(([category, amountCents]) => ({ category, label: categoryLabels[category as keyof typeof categoryLabels], amountCents, sharePercent: totalSpendingCents > 0 ? Math.round((amountCents / totalSpendingCents) * 1000) / 10 : 0 })),
      highestSpendingDays: descending(dates.entries()).slice(0, 5).map(([date, amountCents]) => ({ date, amountCents })),
      highestSpendingPeriods: descending(periods.entries()).slice(0, 4).map(([label, amountCents]) => ({ label, amountCents })),
    },
    windows,
  };
}
