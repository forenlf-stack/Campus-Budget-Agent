import { z } from "zod";

export const budgetPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "预算周期必须为 YYYY-MM");

export function shanghaiPeriodForDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function shanghaiPeriodBounds(period: string) {
  const parsed = budgetPeriodSchema.parse(period);
  const [year, month] = parsed.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: new Date(`${parsed}-01T00:00:00+08:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`),
  };
}

export function shanghaiPeriodStorageDate(period: string): string {
  return `${budgetPeriodSchema.parse(period)}-01T00:00:00.000Z`;
}
