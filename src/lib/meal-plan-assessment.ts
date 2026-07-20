import { z } from "zod";

export const mealPlanAssessmentInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
}).strict();

export const mealPlanAssessmentResponseSchema = z.object({
  level: z.enum(["POSITIVE", "CAUTION", "RECONSIDER"]),
  title: z.string().trim().min(1).max(60),
  reply: z.string().trim().min(1).max(800),
  priceCents: z.number().int().safe().positive(),
  recommendedMealPriceCents: z.number().int().safe().positive(),
  recentAveragePriceCents: z.number().int().safe().nonnegative(),
  recentMealCount: z.number().int().nonnegative(),
  remainingBudgetAfterCents: z.number().int().safe(),
  reasons: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
  source: z.enum(["LLM", "RULES"]),
  fallbackReason: z.string().optional(),
}).strict();

export type MealPlanAssessmentResponse = z.infer<typeof mealPlanAssessmentResponseSchema>;
