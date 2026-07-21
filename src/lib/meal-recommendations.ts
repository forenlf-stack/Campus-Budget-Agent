import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealPeriods } from "@/lib/meal-candidates";

export const mealRecommendationQuickTags = ["SAVE_MONEY", "TRY_DIFFERENT", "LIGHT", "SPICY", "STAY_NEAR"] as const;
export const mealRecommendationTypes = ["OVERALL", "SAVE_MONEY", "TASTE", "NEW_OR_CONVENIENT"] as const;

export const mealRecommendationReasonLabels: Record<string, string> = {
  RECENT_MEALS_EXPENSIVE: "最近吃得偏贵",
  WITHIN_RECOMMENDED_PRICE: "价格合适",
  MATCHES_FOOD_LIKES: "符合口味",
  MATCHES_LIGHT: "清淡",
  MATCHES_SPICY: "辣味",
  NOT_RECENTLY_EATEN: "最近没吃过",
  HIGH_USER_RATING: "历史高分",
  CONVENIENT_LOCATION: "地点方便",
};

export const mealRecommendationRiskLabels: Record<string, string> = {
  ABOVE_RECOMMENDED_PRICE: "价格高于建议正餐价",
  WILL_EXCEED_TOTAL_BUDGET: "可能超过总预算",
  RECENTLY_EATEN: "最近吃过，变化较少",
  MATCHES_FOOD_DISLIKES: "包含不喜欢的口味",
  INGREDIENT_INFO_UNKNOWN: "食材信息不完整",
  ABOVE_PREFERRED_PRICE_RANGE: "高于平时设置的正餐参考上限",
  MEAL_PERIOD_MISMATCH: "不是当前时段的常规选择",
  LOCATION_MISMATCH: "距离默认地点可能较远",
};

export function mealRecommendationReasonLabel(reason: string): string {
  return mealRecommendationReasonLabels[reason] ?? reason;
}

export function mealRecommendationRiskLabel(risk: string): string {
  return mealRecommendationRiskLabels[risk] ?? risk;
}

export const directMealRecommendationInputSchema = z.object({
  quickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length).default([]),
  excludeCandidateIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  userRequest: z.string().trim().max(agentCapabilities.languageUnderstanding.maximumRequestCharacters).default(""),
  maxRecommendations: z.number().int().min(1).max(agentCapabilities.mealRecommendations.maximumCount)
    .default(agentCapabilities.mealRecommendations.defaultCount),
  skipAgentInterpretation: z.boolean().default(false),
}).strict();

export const mealRecommendationCardSchema = z.object({
  candidateId: z.string(),
  name: z.string(),
  merchant: z.string(),
  acquisitionLabel: z.string(),
  priceCents: z.number().int().safe().positive(),
  recommendationType: z.enum(mealRecommendationTypes),
  shortTags: z.array(z.string()).max(3),
  risk: z.string(),
  actionLabel: z.literal("选这个"),
  details: z.object({
    totalScore: z.number().int(),
    scoreBreakdown: z.object({
      budgetFit: z.number().int(),
      preferenceMatch: z.number().int(),
      recentVariety: z.number().int(),
      historicalRating: z.number().int(),
      locationConvenience: z.number().int(),
    }),
    budgetImpact: z.object({
      remainingBudgetAfterCents: z.number().int().safe(),
      mealRemainingAfterCents: z.number().int().safe(),
      recommendedDailyBudgetAfterCents: z.number().int().safe(),
      savingsTargetStillOnTrack: z.boolean(),
    }).nullable(),
    executionSteps: z.array(z.object({ step: z.string(), status: z.string() })),
  }),
});

export const directMealRecommendationResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["READY", "NO_RECOMMENDATIONS"]),
  mealPeriod: z.enum(mealPeriods),
  location: z.string().optional(),
  recommendations: z.array(mealRecommendationCardSchema).max(agentCapabilities.mealRecommendations.maximumCount),
  agentResponse: z.object({
    understanding: z.string(),
    response: z.string(),
    source: z.enum(["LLM", "RULES"]),
    fallbackReason: z.string().optional(),
  }).nullable(),
  durationMs: z.number().nonnegative(),
  emptyResultReason: z.string().optional(),
});

export type MealRecommendationQuickTag = (typeof mealRecommendationQuickTags)[number];
export type MealRecommendationType = (typeof mealRecommendationTypes)[number];
export type DirectMealRecommendationInput = z.infer<typeof directMealRecommendationInputSchema>;
export type MealRecommendationCard = z.infer<typeof mealRecommendationCardSchema>;
export type DirectMealRecommendationResponse = z.infer<typeof directMealRecommendationResponseSchema>;
