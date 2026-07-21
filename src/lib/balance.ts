const shanghaiTimeZone = "Asia/Shanghai";

function shanghaiYearMonth(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: shanghaiTimeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function allowanceDueAt(year: number, month: number, allowanceDay: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(allowanceDay, lastDay);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60_000);
}

export function countAllowanceOccurrences(balanceAsOf: Date, now: Date, allowanceDay: number) {
  if (!Number.isFinite(balanceAsOf.getTime()) || !Number.isFinite(now.getTime()) || now <= balanceAsOf) return 0;
  const start = shanghaiYearMonth(balanceAsOf);
  const end = shanghaiYearMonth(now);
  let cursor = start.year * 12 + start.month - 1;
  const finalMonth = end.year * 12 + end.month - 1;
  let count = 0;
  for (; cursor <= finalMonth; cursor += 1) {
    const year = Math.floor(cursor / 12);
    const month = cursor % 12 + 1;
    const dueAt = allowanceDueAt(year, month, allowanceDay);
    if (dueAt > balanceAsOf && dueAt <= now) count += 1;
  }
  return count;
}

export function calculateCurrentBalanceCents(input: {
  openingBalanceCents: number;
  balanceAsOf: Date;
  now: Date;
  monthlyAllowanceCents: number;
  allowanceDay: number;
  transactionDeltaCents: number;
}) {
  const allowanceCount = countAllowanceOccurrences(input.balanceAsOf, input.now, input.allowanceDay);
  return input.openingBalanceCents + input.transactionDeltaCents + allowanceCount * input.monthlyAllowanceCents;
}
