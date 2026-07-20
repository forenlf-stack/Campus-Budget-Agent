import { z } from "zod";

import { transactionCategories } from "@/lib/budget";

const cents = z.number().int().safe();

export const billAnalysisWindowKeys = ["DAYS_3", "DAYS_7", "DAYS_30", "DAYS_90"] as const;

export const billAnalysisWindowSchema = z.object({
  key: z.enum(billAnalysisWindowKeys),
  label: z.string(),
  days: z.number().int().positive(),
  currentSpendingCents: cents,
  previousSpendingCents: cents,
  changeCents: cents,
  changePercent: z.number().nullable(),
  transactionCount: z.number().int().nonnegative(),
  dailyAverageCents: cents,
}).strict();

export const billAnalysisResponseSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    totalSpendingCents: cents,
    transactionCount: z.number().int().nonnegative(),
    topCategories: z.array(z.object({ category: z.enum(transactionCategories), label: z.string(), amountCents: cents, sharePercent: z.number() })).max(5),
    highestSpendingDays: z.array(z.object({ date: z.string(), amountCents: cents })).max(5),
    highestSpendingPeriods: z.array(z.object({ label: z.string(), amountCents: cents })).max(4),
  }).strict(),
  windows: z.array(billAnalysisWindowSchema).length(4),
  agent: z.object({
    overview: z.string().trim().min(1).max(1200),
    observations: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
    suggestions: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
    toneNote: z.string().trim().min(1).max(200),
    source: z.enum(["LLM", "RULES"]),
    fallbackReason: z.string().optional(),
  }).strict(),
}).strict();

export type BillAnalysisResponse = z.infer<typeof billAnalysisResponseSchema>;
