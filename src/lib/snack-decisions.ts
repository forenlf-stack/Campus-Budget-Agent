import { z } from "zod";

const positiveCents = z.number().int().safe().positive();

export const snackDecisionInputSchema = z.object({
  itemName: z.string().trim().min(1, "请输入零食或饮料名称").max(100),
  priceCents: positiveCents,
  merchant: z.string().trim().max(100).default(""),
  occurredAt: z.iso.datetime(),
}).strict();

export const snackDecisionResponseSchema = z.object({
  level: z.enum(["GREEN", "YELLOW", "RED"]),
  recommendation: z.enum(["BUY", "SWITCH_OR_REDUCE", "DELAY_OR_SKIP"]),
  title: z.string(),
  reasons: z.array(z.string()).min(1).max(4),
  alternatives: z.array(z.string()).max(5),
  agentComment: z.string().trim().min(1).max(800).nullable(),
  agentSource: z.enum(["LLM", "RULES"]),
  context: z.object({
    recentDays: z.literal(7),
    recentCount: z.number().int().nonnegative(),
    recentSpendingCents: z.number().int().nonnegative(),
    todayCount: z.number().int().nonnegative(),
    weeklyLimit: z.number().int().nonnegative(),
    weeklyBudgetCents: z.number().int().nonnegative(),
    previousWeekCount: z.number().int().nonnegative(),
    previousWeekSpendingCents: z.number().int().nonnegative(),
    recentAveragePriceCents: z.number().int().nonnegative(),
    frequencyRemainingAfter: z.number().int(),
    weeklyBudgetRemainingAfterCents: z.number().int().safe(),
    remainingBudgetBeforeCents: z.number().int().safe(),
    remainingBudgetAfterCents: z.number().int().safe(),
  }),
}).strict();

export type SnackDecisionInput = z.infer<typeof snackDecisionInputSchema>;
export type SnackDecisionResponse = z.infer<typeof snackDecisionResponseSchema>;

export const confirmSnackPurchaseInputSchema = snackDecisionInputSchema.extend({
  idempotencyKey: z.string().uuid(),
  level: z.enum(["GREEN", "YELLOW", "RED"]),
  recommendation: z.enum(["BUY", "SWITCH_OR_REDUCE", "DELAY_OR_SKIP"]),
  decisionTitle: z.string().trim().min(1).max(200),
}).strict();

export const confirmSnackPurchaseResponseSchema = z.object({
  decisionId: z.string(),
  transactionId: z.string(),
  idempotent: z.boolean(),
  budgetAfter: z.object({
    remainingBudgetCents: z.number().int().safe(),
    recommendedDailyBudgetCents: z.number().int().safe().nonnegative(),
  }),
}).strict();

export type ConfirmSnackPurchaseInput = z.infer<typeof confirmSnackPurchaseInputSchema>;
