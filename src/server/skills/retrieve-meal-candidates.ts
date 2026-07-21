import { z } from "zod";

import { mealPeriods } from "@/lib/meal-candidates";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";

export const retrieveMealCandidatesInputSchema = z.object({
  mealPeriod: z.enum(mealPeriods).optional(),
  location: z.string().trim().min(1).max(100).optional(),
  maximumPriceCents: z.number().int().safe().positive().optional(),
  enabledOnly: z.boolean().default(true),
});

export interface RetrievedMealCandidate {
  id: string;
  name: string;
  merchant: string;
  typicalPriceCents: number;
  location: string;
  mealPeriod: (typeof mealPeriods)[number];
  tags: string[];
  ingredients: string[];
  isSpicy: boolean;
  userRating: number | null;
  lastPurchasedAt: string | null;
  enabled: boolean;
  priceSource: "MANUAL" | "SEED" | "VISION";
  priceUpdatedAt: string;
}

export function retrieveHistoryMeals(input: unknown, store: SkillReadStore = skillReadStore): SkillResult<{ candidates: RetrievedMealCandidate[]; count: number }> {
  try {
    const parsed = retrieveMealCandidatesInputSchema.parse(input);
    const candidates = store.readMealCandidates(parsed).map((item) => ({
      id: item.id, name: item.name, merchant: item.merchant, typicalPriceCents: item.typicalPriceCents,
      location: item.location, mealPeriod: item.mealPeriod, tags: item.tags, ingredients: item.ingredients,
      isSpicy: item.isSpicy, userRating: item.userRating, lastPurchasedAt: item.lastPurchasedAt,
      enabled: item.enabled, priceSource: item.dataSource, priceUpdatedAt: item.priceUpdatedAt,
    }));
    return skillSuccess({ candidates, count: candidates.length });
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "MEAL_CANDIDATE_RETRIEVAL_ERROR", error instanceof Error ? error.message : "查询餐食候选失败");
  }
}

export const retrieveMealCandidates = retrieveHistoryMeals;
