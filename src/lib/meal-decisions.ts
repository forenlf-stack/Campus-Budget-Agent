import { z } from "zod";

import { mealRecommendationTypes } from "./meal-recommendations";

const positiveCents = z.number().int().safe().positive();

export const confirmMealDecisionInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  recommendationRunId: z.string().trim().min(1).max(100),
  candidateId: z.string().trim().min(1).max(100),
  itemName: z.string().trim().min(1).max(100),
  source: z.enum(["HISTORY", "MENU"]),
  recommendationType: z.enum(mealRecommendationTypes),
  recommendationRisk: z.string().trim().min(1).max(200),
  recommendedPriceCents: positiveCents,
  actualPriceCents: positiveCents,
  occurredAt: z.iso.datetime(),
}).strict();

export const confirmMealDecisionResponseSchema = z.object({
  decisionId: z.string(),
  transactionId: z.string(),
  idempotent: z.boolean(),
  budgetImpact: z.object({
    remainingBudgetAfterCents: z.number().int().safe(),
    mealRemainingAfterCents: z.number().int().safe(),
    recommendedDailyBudgetAfterCents: z.number().int().safe(),
    savingsTargetStillOnTrack: z.boolean(),
  }),
  budgetAfter: z.object({
    remainingBudgetCents: z.number().int().safe(),
    mealRemainingCents: z.number().int().safe(),
    recommendedDailyBudgetCents: z.number().int().safe(),
  }),
}).strict();

export type ConfirmMealDecisionInput = z.infer<typeof confirmMealDecisionInputSchema>;
export type ConfirmMealDecisionResponse = z.infer<typeof confirmMealDecisionResponseSchema>;
