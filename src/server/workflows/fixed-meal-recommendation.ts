import { randomUUID } from "node:crypto";

import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import type { MealPeriod } from "@/lib/meal-candidates";
import { directMealRecommendationInputSchema } from "@/lib/meal-recommendations";
import type { SkillError, SkillResult } from "@/lib/skill-result";
import type { SettingsInput } from "@/lib/settings";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";
import { getFinancialContext, type FinancialContextData } from "@/server/skills/get-financial-context";
import { getRecentMealConsumption, type RecentMealConsumptionData } from "@/server/skills/get-recent-meal-consumption";
import { rankMealCandidates, rankMealCandidateSchema, type RankedMealCandidate } from "@/server/skills/rank-meal-candidates";
import { retrieveHistoryMeals, type RetrievedMealCandidate } from "@/server/skills/retrieve-history-meals";
import { simulateBudgetImpact, type BudgetImpactData } from "@/server/skills/simulate-budget-impact";
import { mergeMealRequests, parseMealRequest } from "@/server/skills/parse-meal-request";
import { interpretedMealRequestSchema } from "@/server/llm/agent-reasoning";

export const fixedMealRecommendationInputSchema = directMealRecommendationInputSchema.extend({
  date: z.date().refine((value) => Number.isFinite(value.getTime()), "查询日期无效").optional(),
  interpretedRequest: interpretedMealRequestSchema.nullable().optional(),
});

export type WorkflowStepName = "get_financial_context" | "get_recent_meal_consumption" | "retrieve_history_meals" | "rank_meal_candidates" | "simulate_budget_impact";

export interface WorkflowExecutionStep {
  step: WorkflowStepName;
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "SKIPPED";
  details: Record<string, number | string | boolean>;
  error?: SkillError;
}

export interface FixedMealRecommendation {
  candidate: RetrievedMealCandidate;
  ranking: RankedMealCandidate;
  budgetImpact: BudgetImpactData | null;
  processingError?: SkillError;
}

export interface FixedMealRecommendationData {
  runId: string;
  status: "READY" | "NO_RECOMMENDATIONS";
  mealPeriod: MealPeriod;
  location?: string;
  financialSummary: FinancialContextData;
  recentMealSummary: RecentMealConsumptionData;
  recommendations: FixedMealRecommendation[];
  executionSteps: WorkflowExecutionStep[];
  emptyResultReason?: "NO_CANDIDATES_RETRIEVED" | "ALL_CANDIDATES_INVALID" | "NO_ELIGIBLE_CANDIDATES";
}

export type FixedMealRecommendationResult =
  | { success: true; data: FixedMealRecommendationData }
  | { success: false; runId: string; error: SkillError; executionSteps: WorkflowExecutionStep[] };

export interface FixedMealRecommendationDependencies {
  store: SkillReadStore;
  createRunId: () => string;
  now: () => Date;
  getFinancialContext: typeof getFinancialContext;
  getRecentMealConsumption: typeof getRecentMealConsumption;
  retrieveHistoryMeals: typeof retrieveHistoryMeals;
  rankMealCandidates: typeof rankMealCandidates;
  simulateBudgetImpact: typeof simulateBudgetImpact;
}

const defaultDependencies: FixedMealRecommendationDependencies = {
  store: skillReadStore,
  createRunId: randomUUID,
  now: () => new Date(),
  getFinancialContext,
  getRecentMealConsumption,
  retrieveHistoryMeals,
  rankMealCandidates,
  simulateBudgetImpact,
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function shanghaiMealPeriod(date: Date): MealPeriod {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  if (minutes >= 300 && minutes < 630) return "BREAKFAST";
  if (minutes >= 630 && minutes < 990) return "LUNCH";
  return "DINNER";
}

function failed(runId: string, executionSteps: WorkflowExecutionStep[], step: WorkflowStepName, error: SkillError): FixedMealRecommendationResult {
  executionSteps.push({ step, status: "FAILED", details: {}, error });
  return { success: false, runId, error: { code: `WORKFLOW_${error.code}`, message: `${step}执行失败：${error.message}` }, executionSteps };
}

function emptyResult(
  runId: string,
  mealPeriod: MealPeriod,
  location: string | undefined,
  financialSummary: FinancialContextData,
  recentMealSummary: RecentMealConsumptionData,
  executionSteps: WorkflowExecutionStep[],
  emptyResultReason: FixedMealRecommendationData["emptyResultReason"],
): FixedMealRecommendationResult {
  return { success: true, data: { runId, status: "NO_RECOMMENDATIONS", mealPeriod, ...(location ? { location } : {}), financialSummary, recentMealSummary, recommendations: [], executionSteps, emptyResultReason } };
}

export function runFixedMealRecommendation(
  input: unknown = {},
  dependencyOverrides: Partial<FixedMealRecommendationDependencies> = {},
): FixedMealRecommendationResult {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const runId = dependencies.createRunId();
  const executionSteps: WorkflowExecutionStep[] = [];
  const parsed = fixedMealRecommendationInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, runId, error: { code: "INVALID_INPUT", message: parsed.error.message }, executionSteps };

  const queryDate = parsed.data.date ?? dependencies.now();
  const mealPeriod = shanghaiMealPeriod(queryDate);
  const financial = dependencies.getFinancialContext({ queryDate }, dependencies.store);
  if (!financial.success) return failed(runId, executionSteps, "get_financial_context", financial.error);
  executionSteps.push({ step: "get_financial_context", status: "SUCCESS", details: { budgetPeriod: financial.data.budgetPeriod, remainingBudgetCents: financial.data.remainingBudgetCents } });

  const recent = dependencies.getRecentMealConsumption({ queryDate, recentCount: agentCapabilities.mealRecommendations.recentMealCount }, dependencies.store);
  if (!recent.success) return failed(runId, executionSteps, "get_recent_meal_consumption", recent.error);
  executionSteps.push({ step: "get_recent_meal_consumption", status: "SUCCESS", details: { days: recent.data.days, mealCount: recent.data.mealCount, highPriceThresholdCents: recent.data.highPriceEvidence.thresholdCents } });

  let settings: SettingsInput;
  try {
    settings = dependencies.store.readSettings(financial.data.budgetPeriod);
  } catch (error) {
    return failed(runId, executionSteps, "retrieve_history_meals", { code: "PREFERENCE_CONTEXT_ERROR", message: error instanceof Error ? error.message : "读取长期偏好失败" });
  }
  const location = settings.defaultLocation || undefined;
  const interpreted = parsed.data.interpretedRequest;
  const localRequest = parseMealRequest(parsed.data.userRequest);
  const naturalRequest = interpreted
    ? mergeMealRequests(localRequest, interpreted, parsed.data.userRequest)
    : localRequest;
  const quickTags = unique([...parsed.data.quickTags, ...naturalRequest.quickTags]);
  const retrieved = dependencies.retrieveHistoryMeals({ enabledOnly: true }, dependencies.store);
  if (!retrieved.success) return failed(runId, executionSteps, "retrieve_history_meals", retrieved.error);
  const excluded = new Set(parsed.data.excludeCandidateIds);
  const unexcludedCandidates = retrieved.data.candidates.filter((candidate) => !excluded.has(candidate.id));
  const exclusionFallback = unexcludedCandidates.length === 0 && retrieved.data.candidates.length > 0;
  const rotationOffset = exclusionFallback && retrieved.data.candidates.length > 1
    ? Math.max(1, excluded.size % retrieved.data.candidates.length)
    : 0;
  const retrievedCandidates = exclusionFallback
    ? [...retrieved.data.candidates.slice(rotationOffset), ...retrieved.data.candidates.slice(0, rotationOffset)]
    : unexcludedCandidates;
  executionSteps.push({ step: "retrieve_history_meals", status: "SUCCESS", details: { retrievedCount: retrieved.data.count, excludedCount: retrieved.data.count - unexcludedCandidates.length, exclusionFallback, rotationOffset, referencePriceLimitCents: financial.data.lunchHardLimitCents, explicitHardPriceLimitCents: naturalRequest.hardPriceLimitCents ?? 0, mealPeriod, ...(location ? { location } : {}) } });
  if (retrievedCandidates.length === 0) {
    executionSteps.push({ step: "rank_meal_candidates", status: "SKIPPED", details: { reason: "NO_CANDIDATES_RETRIEVED" } });
    executionSteps.push({ step: "simulate_budget_impact", status: "SKIPPED", details: { reason: "NO_RANKED_CANDIDATES" } });
    return emptyResult(runId, mealPeriod, location, financial.data, recent.data, executionSteps, "NO_CANDIDATES_RETRIEVED");
  }

  const candidates = retrievedCandidates.filter((candidate) => rankMealCandidateSchema.safeParse(candidate).success);
  const rotatedCandidateIds = exclusionFallback ? candidates.map((candidate) => candidate.id) : [];
  if (candidates.length === 0) {
    executionSteps.push({ step: "rank_meal_candidates", status: "SKIPPED", details: { reason: "ALL_CANDIDATES_INVALID", invalidCandidateCount: retrievedCandidates.length } });
    executionSteps.push({ step: "simulate_budget_impact", status: "SKIPPED", details: { reason: "NO_RANKED_CANDIDATES" } });
    return emptyResult(runId, mealPeriod, location, financial.data, recent.data, executionSteps, "ALL_CANDIDATES_INVALID");
  }

  const ranked = dependencies.rankMealCandidates({
    candidates,
    financialContext: financial.data,
    recentMealContext: recent.data,
    longTermPreferences: {
      foodLikes: unique([...settings.foodLikes, ...naturalRequest.preferredTerms]),
      foodDislikes: unique([...settings.foodDislikes, ...naturalRequest.avoidedTerms]),
      strictAvoidances: unique([...settings.foodAllergens, ...naturalRequest.strictAvoidedTerms]),
      ...(settings.defaultLocation ? { defaultLocation: settings.defaultLocation } : {}),
    },
    temporaryPreferences: {
      mealPeriod,
      referencePriceLimitCents: financial.data.lunchHardLimitCents,
      ...(naturalRequest.hardPriceLimitCents ? { hardPriceLimitCents: naturalRequest.hardPriceLimitCents } : {}),
      ...(naturalRequest.targetPriceCents ? { targetPriceCents: naturalRequest.targetPriceCents } : {}),
      quickTags,
    },
    maxRecommendations: parsed.data.maxRecommendations,
  });
  if (!ranked.success) return failed(runId, executionSteps, "rank_meal_candidates", ranked.error);
  if (exclusionFallback) {
    const rotatedOrder = new Map(rotatedCandidateIds.map((candidateId, index) => [candidateId, index]));
    ranked.data.recommendations.sort((left, right) => (rotatedOrder.get(left.candidateId) ?? 0) - (rotatedOrder.get(right.candidateId) ?? 0));
  }
  executionSteps.push({ step: "rank_meal_candidates", status: "SUCCESS", details: { validCandidateCount: candidates.length, invalidCandidateCount: retrievedCandidates.length - candidates.length, rankedCount: ranked.data.recommendations.length, quickTagCount: quickTags.length } });
  if (ranked.data.status === "NO_ELIGIBLE_CANDIDATES") {
    executionSteps.push({ step: "simulate_budget_impact", status: "SKIPPED", details: { reason: "NO_RANKED_CANDIDATES" } });
    return emptyResult(runId, mealPeriod, location, financial.data, recent.data, executionSteps, "NO_ELIGIBLE_CANDIDATES");
  }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const recommendations = ranked.data.recommendations.slice(0, parsed.data.maxRecommendations).flatMap((ranking): FixedMealRecommendation[] => {
    const candidate = candidatesById.get(ranking.candidateId);
    if (!candidate) return [];
    let impact: SkillResult<BudgetImpactData>;
    try {
      impact = dependencies.simulateBudgetImpact({ candidatePriceCents: ranking.estimatedPriceCents, financialContext: financial.data });
    } catch (error) {
      impact = { success: false, error: { code: "BUDGET_SIMULATION_ERROR", message: error instanceof Error ? error.message : "预算影响模拟失败" } };
    }
    const deterministicRisks = impact.success
      ? [
          ...(impact.data.exceedsRecommendedPrice ? ["ABOVE_RECOMMENDED_PRICE"] : []),
          ...(impact.data.remainingBudgetAfterCents < 0 ? ["WILL_EXCEED_TOTAL_BUDGET"] : []),
          ...ranking.risks.filter((risk) => !["ABOVE_RECOMMENDED_PRICE", "WILL_EXCEED_TOTAL_BUDGET"].includes(risk)),
        ]
      : ranking.risks;
    return [{ candidate, ranking: { ...ranking, risks: [...new Set(deterministicRisks)] }, budgetImpact: impact.success ? impact.data : null, ...(!impact.success ? { processingError: impact.error } : {}) }];
  });
  const failedSimulations = recommendations.filter((item) => item.processingError).length;
  executionSteps.push({ step: "simulate_budget_impact", status: failedSimulations ? "PARTIAL_SUCCESS" : "SUCCESS", details: { attemptedCount: recommendations.length, succeededCount: recommendations.length - failedSimulations, failedCount: failedSimulations } });
  return { success: true, data: { runId, status: "READY", mealPeriod, ...(location ? { location } : {}), financialSummary: financial.data, recentMealSummary: recent.data, recommendations, executionSteps } };
}
