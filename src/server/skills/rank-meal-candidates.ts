import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealPeriods } from "@/lib/meal-candidates";
import { mealRecommendationQuickTags, mealRecommendationTypes, type MealRecommendationQuickTag, type MealRecommendationType } from "@/lib/meal-recommendations";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import { type FinancialContextData } from "./get-financial-context";
import { type RecentMealConsumptionData } from "./get-recent-meal-consumption";
import { type RetrievedMealCandidate } from "./retrieve-meal-candidates";

export const mealQuickTags = mealRecommendationQuickTags;
export type MealQuickTag = MealRecommendationQuickTag;
export const recommendationTypes = mealRecommendationTypes;
export type RecommendationType = MealRecommendationType;

const safeCents = z.number().int().safe();
const positiveCents = safeCents.positive();
const stringList = z.array(z.string().trim().min(1));

export const rankMealCandidateSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), merchant: z.string().min(1), typicalPriceCents: positiveCents,
  location: z.string().min(1), mealPeriod: z.enum(mealPeriods), tags: stringList, ingredients: stringList,
  isSpicy: z.boolean(), userRating: z.number().int().min(1).max(5).nullable(), lastPurchasedAt: z.string().nullable(),
  enabled: z.boolean(), priceSource: z.enum(["MANUAL", "SEED", "VISION"]), priceUpdatedAt: z.string().min(1),
});

const financialContextSchema = z.object({
  budgetPeriod: z.string(), flexibleBudgetCents: safeCents, actualNetSpendingCents: safeCents.nonnegative(), remainingBudgetCents: safeCents,
  mealBudgetCents: safeCents.nonnegative(), mealUsedCents: safeCents.nonnegative(), mealRemainingCents: safeCents,
  remainingDays: z.number().int().nonnegative(), recommendedDailyBudgetCents: safeCents.nonnegative(),
  recommendedDailyBudgetStatus: z.enum(["AVAILABLE", "NO_REMAINING_BUDGET", "PERIOD_ENDED"]),
  recommendedLunchPriceCents: safeCents.nonnegative(), lunchHardLimitCents: safeCents.nonnegative(),
  savingsTarget: z.object({ status: z.enum(["CONFIGURED", "NOT_CONFIGURED"]), targetCents: safeCents.nonnegative() }),
});

const recentContextSchema = z.object({
  recentMeals: z.array(z.object({ id: z.string(), name: z.string(), merchant: z.string().nullable(), amountCents: positiveCents, occurredAt: z.date() })),
  highRecentPriceTriggered: z.boolean().optional(),
}).passthrough();

export const rankMealCandidatesInputSchema = z.object({
  candidates: z.array(rankMealCandidateSchema),
  financialContext: financialContextSchema,
  recentMealContext: recentContextSchema,
  longTermPreferences: z.object({
    foodLikes: stringList,
    foodDislikes: stringList,
    strictAvoidances: stringList,
    defaultLocation: z.string().trim().min(1).optional(),
  }),
  temporaryPreferences: z.object({
    mealPeriod: z.enum(mealPeriods),
    location: z.string().trim().min(1).optional(),
    referencePriceLimitCents: positiveCents.optional(),
    targetPriceCents: positiveCents.optional(),
    hardPriceLimitCents: positiveCents.optional(),
    quickTags: z.array(z.enum(mealQuickTags)).max(mealQuickTags.length).default([]),
  }),
  maxRecommendations: z.number().int().min(1).max(agentCapabilities.mealRecommendations.maximumCount)
    .default(agentCapabilities.mealRecommendations.defaultCount),
});

export interface RankedMealCandidate {
  candidateId: string;
  totalScore: number;
  scoreBreakdown: { budgetFit: number; preferenceMatch: number; recentVariety: number; historicalRating: number; locationConvenience: number };
  estimatedPriceCents: number;
  recommendationLevel: "STRONG" | "GOOD" | "ACCEPTABLE";
  recommendationType: RecommendationType;
  reasons: string[];
  risks: string[];
  dataSource: "MANUAL" | "SEED" | "VISION";
  priceUpdatedAt: string;
}

export interface RankMealCandidatesData {
  status: "READY" | "NO_ELIGIBLE_CANDIDATES";
  recommendations: RankedMealCandidate[];
  filtered: Array<{ candidateId: string; reasons: string[] }>;
}

function normalized(values: string[]) {
  return values.map((value) => value.trim().toLocaleLowerCase("zh-CN")).filter(Boolean);
}

function candidateTerms(candidate: RetrievedMealCandidate) {
  return normalized([candidate.name, candidate.merchant, ...candidate.tags, ...candidate.ingredients]);
}

function preferenceMatches(candidate: RetrievedMealCandidate, preferences: string[]) {
  const candidateValues = candidateTerms(candidate);
  return normalized(preferences).filter((preference) => candidateValues.some((value) => value.includes(preference) || preference.includes(value)));
}

function intersections(candidate: RetrievedMealCandidate, preferences: string[]) {
  return preferenceMatches(candidate, preferences).length;
}

function containsAny(candidate: RetrievedMealCandidate, words: string[]) {
  const text = [candidate.name, candidate.merchant, ...candidate.tags, ...candidate.ingredients].join(" ").toLocaleLowerCase("zh-CN");
  return words.some((word) => text.includes(word));
}

function budgetScore(price: number, recommended: number, hardLimit: number, emphasizeSavings: boolean) {
  if (recommended <= 0 || hardLimit <= 0) return 0;
  if (price <= recommended) {
    if (!emphasizeSavings) return 3_500;
    return Math.min(3_500, 2_800 + Math.floor((700 * (recommended - price)) / recommended));
  }
  if (recommended >= hardLimit) return 3_500;
  return Math.max(0, Math.floor((3_500 * (hardLimit - price)) / (hardLimit - recommended)));
}

function compareBy(getScore: (item: RankedMealCandidate) => number) {
  return (left: RankedMealCandidate, right: RankedMealCandidate) => getScore(right) - getScore(left)
    || right.totalScore - left.totalScore
    || left.estimatedPriceCents - right.estimatedPriceCents
    || left.candidateId.localeCompare(right.candidateId);
}

export function rankMealCandidates(input: unknown): SkillResult<RankMealCandidatesData> {
  try {
    const parsed = rankMealCandidatesInputSchema.parse(input);
    const filtered: RankMealCandidatesData["filtered"] = [];
    const hardLimit = parsed.temporaryPreferences.hardPriceLimitCents;
    const referenceLimit = parsed.temporaryPreferences.referencePriceLimitCents ?? parsed.financialContext.lunchHardLimitCents;
    const quickTags = new Set(parsed.temporaryPreferences.quickTags);
    const eligible = parsed.candidates.filter((candidate) => {
      const reasons: string[] = [];
      if (!candidate.enabled) reasons.push("DISABLED");
      if (preferenceMatches(candidate, parsed.longTermPreferences.strictAvoidances).length > 0) reasons.push("STRICT_AVOIDANCE_CONFLICT");
      if (hardLimit !== undefined && candidate.typicalPriceCents > hardLimit) reasons.push("HARD_PRICE_LIMIT_EXCEEDED");
      if (reasons.length) filtered.push({ candidateId: candidate.id, reasons });
      return reasons.length === 0;
    });

    const emphasizeSavings = quickTags.has("SAVE_MONEY") || parsed.recentMealContext.highRecentPriceTriggered === true;
    const scored = eligible.map((candidate): RankedMealCandidate => {
      const likeMatches = intersections(candidate, parsed.longTermPreferences.foodLikes);
      const dislikeMatches = intersections(candidate, parsed.longTermPreferences.foodDislikes);
      const repeatCount = parsed.recentMealContext.recentMeals.filter((meal) => meal.name === candidate.name).length;
      const mealPeriodMismatch = candidate.mealPeriod !== "ALL_DAY" && candidate.mealPeriod !== parsed.temporaryPreferences.mealPeriod;
      const isLight = containsAny(candidate, ["清淡", "少油", "低脂", "蒸", "汤", "蔬菜"]);
      const isSpicy = candidate.isSpicy || containsAny(candidate, ["辣", "麻辣", "香辣"]);
      let preferenceMatch = 1_500 + likeMatches * 500 - dislikeMatches * 1_000;
      if (quickTags.has("LIGHT")) {
        if (isLight) preferenceMatch += 1_000;
        if (isSpicy) preferenceMatch -= 1_500;
      }
      if (quickTags.has("SPICY") && isSpicy) preferenceMatch += 1_000;
      const targetPrice = parsed.temporaryPreferences.targetPriceCents;
      const targetPriceAdjustment = targetPrice
        ? Math.max(0, 600 - Math.floor(Math.abs(candidate.typicalPriceCents - targetPrice) / 2))
        : 0;
      const baseVarietyScore = repeatCount === 0 ? 1_500 : quickTags.has("TRY_DIFFERENT") ? 0 : repeatCount === 1 ? 750 : 0;
      const scoreBreakdown = {
        budgetFit: Math.min(3_500, budgetScore(candidate.typicalPriceCents, parsed.financialContext.recommendedLunchPriceCents, referenceLimit, emphasizeSavings) + targetPriceAdjustment),
        preferenceMatch: Math.max(0, Math.min(3_000, preferenceMatch)),
        recentVariety: Math.max(0, baseVarietyScore - (mealPeriodMismatch ? 750 : 0)),
        historicalRating: candidate.userRating === null ? 500 : candidate.userRating * 200,
        locationConvenience: candidate.location === (parsed.temporaryPreferences.location ?? parsed.longTermPreferences.defaultLocation) ? 1_000 : 500,
      };
      const stayNearMismatch = quickTags.has("STAY_NEAR")
        && Boolean(parsed.longTermPreferences.defaultLocation)
        && candidate.location !== parsed.longTermPreferences.defaultLocation;
      const quickTagAdjustment = quickTags.has("SAVE_MONEY")
        ? Math.floor(Math.max(0, parsed.financialContext.recommendedLunchPriceCents - candidate.typicalPriceCents) / 2)
        : 0;
      const totalScore = Math.max(0, Object.values(scoreBreakdown).reduce((total, score) => total + score, 0) + quickTagAdjustment - (stayNearMismatch ? 1_000 : 0));
      const reasons = [
        ...(parsed.recentMealContext.highRecentPriceTriggered ? ["RECENT_MEALS_EXPENSIVE"] : []),
        ...(candidate.typicalPriceCents <= parsed.financialContext.recommendedLunchPriceCents ? ["WITHIN_RECOMMENDED_PRICE"] : []),
        ...(likeMatches ? ["MATCHES_FOOD_LIKES"] : []),
        ...(quickTags.has("LIGHT") && isLight ? ["MATCHES_LIGHT"] : []),
        ...(quickTags.has("SPICY") && isSpicy ? ["MATCHES_SPICY"] : []),
        ...(repeatCount === 0 ? ["NOT_RECENTLY_EATEN"] : []),
        ...(candidate.userRating !== null && candidate.userRating >= 4 ? ["HIGH_USER_RATING"] : []),
        ...(scoreBreakdown.locationConvenience === 1_000 ? ["CONVENIENT_LOCATION"] : []),
      ].slice(0, 3);
      const risks = [
        ...(candidate.typicalPriceCents > parsed.financialContext.recommendedLunchPriceCents ? ["ABOVE_RECOMMENDED_PRICE"] : []),
        ...(candidate.typicalPriceCents > referenceLimit ? ["ABOVE_PREFERRED_PRICE_RANGE"] : []),
        ...(candidate.typicalPriceCents > parsed.financialContext.remainingBudgetCents ? ["WILL_EXCEED_TOTAL_BUDGET"] : []),
        ...(mealPeriodMismatch ? ["MEAL_PERIOD_MISMATCH"] : []),
        ...(stayNearMismatch ? ["LOCATION_MISMATCH"] : []),
        ...(repeatCount ? ["RECENTLY_EATEN"] : []),
        ...(dislikeMatches ? ["MATCHES_FOOD_DISLIKES"] : []),
        ...(candidate.ingredients.length === 0 ? ["INGREDIENT_INFO_UNKNOWN"] : []),
      ];
      return { candidateId: candidate.id, totalScore, scoreBreakdown, estimatedPriceCents: candidate.typicalPriceCents, recommendationLevel: totalScore >= 8_000 ? "STRONG" : totalScore >= 6_000 ? "GOOD" : "ACCEPTABLE", recommendationType: "OVERALL", reasons, risks, dataSource: candidate.priceSource, priceUpdatedAt: candidate.priceUpdatedAt };
    });

    const directions: Array<[RecommendationType, (item: RankedMealCandidate) => number]> = [
      ["OVERALL", (item) => item.totalScore],
      ["SAVE_MONEY", (item) => item.scoreBreakdown.budgetFit],
      ["TASTE", (item) => item.scoreBreakdown.preferenceMatch],
      ["NEW_OR_CONVENIENT", (item) => item.scoreBreakdown.recentVariety + item.scoreBreakdown.locationConvenience],
    ];
    const selected: RankedMealCandidate[] = [];
    const selectedIds = new Set<string>();
    for (const [recommendationType, selector] of directions) {
      if (selected.length >= parsed.maxRecommendations) break;
      const choice = [...scored].sort(compareBy(selector)).find((item) => !selectedIds.has(item.candidateId));
      if (choice) {
        selected.push({ ...choice, recommendationType });
        selectedIds.add(choice.candidateId);
      }
    }
    for (const choice of [...scored].sort(compareBy((item) => item.totalScore))) {
      if (selected.length >= parsed.maxRecommendations) break;
      if (!selectedIds.has(choice.candidateId)) {
        selected.push({ ...choice, recommendationType: "OVERALL" });
        selectedIds.add(choice.candidateId);
      }
    }

    return skillSuccess({ status: selected.length ? "READY" : "NO_ELIGIBLE_CANDIDATES", recommendations: selected, filtered });
  } catch (error) {
    return skillFailure(error instanceof z.ZodError ? "INVALID_INPUT" : "RANKING_ERROR", error instanceof Error ? error.message : "餐食排序失败");
  }
}

export type RankFinancialContext = FinancialContextData;
export type RankRecentMealContext = RecentMealConsumptionData;
