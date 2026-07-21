import { randomUUID } from "node:crypto";

import { agentCapabilities } from "@/lib/agent-capabilities";
import {
  menuCandidateSchema,
  menuMealRecommendationInputSchema,
  menuMealRecommendationResponseSchema,
  type MenuCandidate,
  type MenuMealRecommendationResponse,
} from "@/lib/menu-meal-recommendations";
import { mealRecommendationReasonLabel, mealRecommendationRiskLabel, type MealRecommendationCard } from "@/lib/meal-recommendations";
import type { SkillError } from "@/lib/skill-result";
import type { SettingsInput } from "@/lib/settings";
import { skillReadStore, type SkillReadStore } from "@/server/skill-read-store";
import { extractMenuCandidates } from "@/server/skills/extract-menu-candidates";
import { getFinancialContext } from "@/server/skills/get-financial-context";
import { getRecentMealConsumption } from "@/server/skills/get-recent-meal-consumption";
import { rankMealCandidates } from "@/server/skills/rank-meal-candidates";
import type { RetrievedMealCandidate } from "@/server/skills/retrieve-meal-candidates";
import { simulateBudgetImpact } from "@/server/skills/simulate-budget-impact";
import { parseMealRequest } from "@/server/skills/parse-meal-request";
import { interpretMealRequestWithLlm } from "@/server/llm/agent-reasoning";
import { shanghaiMealPeriod } from "./fixed-meal-recommendation";

const ambiguousPricePattern = /(?:会员价|会员专享|起售价?|起步价|价格?起|任选|选规格|选套餐|多规格|不同规格|[~～])/i;
const explicitPricePattern = /(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/g;

export type MenuMealRecommendationResult =
  | { success: true; data: MenuMealRecommendationResponse }
  | { success: false; runId: string; error: SkillError };

export interface MenuMealRecommendationDependencies {
  store: SkillReadStore;
  createRunId: () => string;
  now: () => Date;
  extractMenuCandidates: typeof extractMenuCandidates;
  getFinancialContext: typeof getFinancialContext;
  getRecentMealConsumption: typeof getRecentMealConsumption;
  rankMealCandidates: typeof rankMealCandidates;
  simulateBudgetImpact: typeof simulateBudgetImpact;
}

const defaultDependencies: MenuMealRecommendationDependencies = {
  store: skillReadStore,
  createRunId: randomUUID,
  now: () => new Date(),
  extractMenuCandidates,
  getFinancialContext,
  getRecentMealConsumption,
  rankMealCandidates,
  simulateBudgetImpact,
};

function elapsed(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const recognitionWarningLabels: Record<MenuCandidate["risks"][number], string> = {
  LOW_CONFIDENCE: "部分候选识别置信度较低，请核对菜名和价格",
  IMAGE_BLURRY: "图片中存在模糊内容，请核对识别结果",
  PRICE_UNCERTAIN: "部分价格不确定，确认实际价格后才能参与预算推荐",
  MEMBER_PRICE: "检测到原价或会员价并列，未自动选择价格",
  SET_PRICE: "该商品存在多种套餐或规格，当前价格无法唯一对应",
};

function recognitionSummary(source: "image" | "menuText", candidates: MenuCandidate[], rejectedCandidateCount: number) {
  const warnings = unique(candidates.flatMap((candidate) => candidate.risks.map((risk) => recognitionWarningLabels[risk])));
  return {
    source,
    detectedCount: candidates.length + rejectedCandidateCount,
    validCount: candidates.length,
    rejectedCount: rejectedCandidateCount,
    warnings,
  };
}

function parseMenuText(menuText: string): MenuCandidate[] {
  return menuText.split(/\r?\n/).flatMap((rawLine, index): MenuCandidate[] => {
    const line = rawLine.trim();
    if (!line) return [];
    const matches = [...line.matchAll(explicitPricePattern)];
    const ambiguous = ambiguousPricePattern.test(line) || matches.length !== 1;
    const priceMatch = matches.length === 1 ? matches[0] : undefined;
    const name = priceMatch
      ? line.slice(0, priceMatch.index).replace(/[\s:：.。·\-—]+$/, "").trim()
      : line.replace(/[\s:：.。·\-—]+$/, "").trim();
    if (!name || (!priceMatch && !ambiguousPricePattern.test(line))) return [];
    const yuan = priceMatch ? Number(priceMatch[1]) : Number.NaN;
    const priceCents = !ambiguous && Number.isFinite(yuan) && yuan > 0 && Number.isSafeInteger(Math.round(yuan * 100))
      ? Math.round(yuan * 100)
      : null;
    return [menuCandidateSchema.parse({
      temporaryId: `text-${index + 1}`,
      name,
      priceCents,
      priceText: priceMatch?.[0].trim() ?? null,
      description: null,
      visibleTags: [],
      confidence: priceCents === null ? 0.5 : 1,
      source: "MENU_TEXT",
      rawTextReference: line,
      needsConfirmation: priceCents === null,
      risks: priceCents === null ? ["PRICE_UNCERTAIN"] : [],
    })];
  });
}

function applyConfirmedPrices(candidates: MenuCandidate[], confirmedPrices: Array<{ temporaryId: string; priceCents: number }>) {
  const confirmed = new Map(confirmedPrices.map((item) => [item.temporaryId, item.priceCents]));
  return candidates.map((candidate): MenuCandidate => {
    const priceCents = confirmed.get(candidate.temporaryId);
    if (priceCents === undefined) return candidate;
    return { ...candidate, priceCents, priceText: `${priceCents / 100}元`, needsConfirmation: false, risks: candidate.risks.filter((risk) => risk !== "PRICE_UNCERTAIN") };
  });
}

function toRetrievedCandidate(candidate: MenuCandidate, settings: SettingsInput, mealPeriod: RetrievedMealCandidate["mealPeriod"], now: Date): RetrievedMealCandidate | null {
  if (candidate.priceCents === null) return null;
  const terms = unique([candidate.name, candidate.description ?? "", ...candidate.visibleTags]);
  return {
    id: candidate.temporaryId,
    name: candidate.name,
    merchant: "菜单识别",
    typicalPriceCents: candidate.priceCents,
    location: settings.defaultLocation || "当前菜单",
    mealPeriod,
    tags: terms,
    ingredients: terms,
    isSpicy: terms.some((term) => /辣|麻辣|香辣/.test(term)),
    userRating: null,
    lastPurchasedAt: null,
    enabled: true,
    priceSource: candidate.source === "VISION" ? "VISION" : "MANUAL",
    priceUpdatedAt: now.toISOString(),
  };
}

function recommendationCard(
  candidate: RetrievedMealCandidate,
  ranking: Extract<ReturnType<typeof rankMealCandidates>, { success: true }>["data"]["recommendations"][number],
  budgetImpact: ReturnType<typeof simulateBudgetImpact>,
): MealRecommendationCard {
  const budgetRisks = budgetImpact.success
    ? [
        ...(budgetImpact.data.exceedsRecommendedPrice ? ["ABOVE_RECOMMENDED_PRICE"] : []),
        ...(budgetImpact.data.remainingBudgetAfterCents < 0 ? ["WILL_EXCEED_TOTAL_BUDGET"] : []),
      ]
    : ranking.risks;
  const nonBudgetRisks = ranking.risks.filter((risk) => !["ABOVE_RECOMMENDED_PRICE", "WILL_EXCEED_TOTAL_BUDGET"].includes(risk));
  const risks = [...new Set([...budgetRisks, ...nonBudgetRisks])];
  return {
    candidateId: candidate.id,
    name: candidate.name,
    merchant: candidate.merchant,
    acquisitionLabel: candidate.location,
    priceCents: candidate.typicalPriceCents,
    recommendationType: ranking.recommendationType,
    shortTags: ranking.reasons.slice(0, 3).map(mealRecommendationReasonLabel),
    risk: risks.length ? mealRecommendationRiskLabel(risks[0]) : "暂无明显风险",
    actionLabel: "选这个",
    details: {
      totalScore: ranking.totalScore,
      scoreBreakdown: ranking.scoreBreakdown,
      budgetImpact: budgetImpact.success ? {
        remainingBudgetAfterCents: budgetImpact.data.remainingBudgetAfterCents,
        mealRemainingAfterCents: budgetImpact.data.mealRemainingAfterCents,
        recommendedDailyBudgetAfterCents: budgetImpact.data.recommendedDailyBudgetAfterCents,
        savingsTargetStillOnTrack: budgetImpact.data.savingsTargetStillOnTrack,
      } : null,
      executionSteps: [
        { step: "extract_menu_candidates", status: "SUCCESS" },
        { step: "rank_meal_candidates", status: "SUCCESS" },
        { step: "simulate_budget_impact", status: budgetImpact.success ? "SUCCESS" : "FAILED" },
      ],
    },
  };
}

export async function runMenuMealRecommendation(
  input: unknown,
  dependencyOverrides: Partial<MenuMealRecommendationDependencies> = {},
): Promise<MenuMealRecommendationResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const runId = dependencies.createRunId();
  const startedAt = performance.now();
  const parsed = menuMealRecommendationInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, runId, error: { code: "INVALID_INPUT", message: parsed.error.message } };
  const queryDate = parsed.data.date ?? dependencies.now();
  const mealPeriod = shanghaiMealPeriod(queryDate);

  const extractionStartedAt = performance.now();
  let candidates: MenuCandidate[];
  let rejectedCandidateCount = 0;
  if (parsed.data.source.type === "image") {
    const extracted = await dependencies.extractMenuCandidates({ image: parsed.data.source.image, mimeType: parsed.data.source.mimeType });
    if (!extracted.success) return { success: false, runId, error: extracted.error };
    candidates = extracted.data.candidates;
    rejectedCandidateCount = extracted.data.rejectedCandidateCount;
  } else {
    candidates = parseMenuText(parsed.data.source.menuText);
  }
  candidates = applyConfirmedPrices(candidates, parsed.data.confirmedPrices);
  const extractionMs = elapsed(extractionStartedAt);

  const emptyResponse = (status: "NO_MENU_CONTENT" | "INSUFFICIENT_MENU_CONTENT"): MenuMealRecommendationResult => ({
    success: true,
    data: menuMealRecommendationResponseSchema.parse({
      runId, status, source: parsed.data.source.type, mealPeriod,
      recognition: recognitionSummary(parsed.data.source.type, candidates, rejectedCandidateCount),
      pendingConfirmation: candidates.filter((candidate) => candidate.needsConfirmation),
      recommendations: [], rejectedCandidateCount,
      timing: { extractionMs, contextMs: 0, rankingMs: 0, totalMs: elapsed(startedAt) },
    }),
  });
  if (candidates.length === 0) return emptyResponse("NO_MENU_CONTENT");
  const contextStartedAt = performance.now();
  const financial = dependencies.getFinancialContext({ queryDate }, dependencies.store);
  if (!financial.success) return { success: false, runId, error: financial.error };
  const recent = dependencies.getRecentMealConsumption({ queryDate, recentCount: agentCapabilities.mealRecommendations.recentMealCount }, dependencies.store);
  if (!recent.success) return { success: false, runId, error: recent.error };
  let settings: SettingsInput;
  try {
    settings = dependencies.store.readSettings(financial.data.budgetPeriod);
  } catch (error) {
    return { success: false, runId, error: { code: "PREFERENCE_CONTEXT_ERROR", message: error instanceof Error ? error.message : "读取长期偏好失败" } };
  }
  const contextMs = elapsed(contextStartedAt);
  let naturalRequest = parseMealRequest(parsed.data.userRequest);
  if (!parsed.data.skipAgentInterpretation) {
    try {
      const interpreted = await interpretMealRequestWithLlm(parsed.data.userRequest);
      if (interpreted) naturalRequest = {
        quickTags: interpreted.quickTags,
        historyQuery: null,
        preferredTerms: interpreted.preferredTerms,
        avoidedTerms: interpreted.avoidedTerms,
        strictAvoidedTerms: interpreted.strictAvoidedTerms,
        ...(interpreted.hardPriceLimitCents ? { hardPriceLimitCents: interpreted.hardPriceLimitCents } : {}),
        ...(interpreted.targetPriceCents ? { targetPriceCents: interpreted.targetPriceCents } : {}),
      };
    } catch { /* Keep menu recommendation available without the LLM. */ }
  }
  const quickTags = unique([...parsed.data.quickTags, ...naturalRequest.quickTags]);

  const rankingStartedAt = performance.now();
  const pricedCandidates = candidates.flatMap((candidate) => {
    if (candidate.needsConfirmation || candidate.confidence < 0.75 || candidate.priceCents === null) return [];
    const retrieved = toRetrievedCandidate(candidate, settings, mealPeriod, queryDate);
    return retrieved ? [retrieved] : [];
  });
  const ranked = dependencies.rankMealCandidates({
    candidates: pricedCandidates,
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
      ...(settings.defaultLocation ? { location: settings.defaultLocation } : {}),
    },
    maxRecommendations: parsed.data.maxRecommendations,
  });
  if (!ranked.success) return { success: false, runId, error: ranked.error };
  const byId = new Map(pricedCandidates.map((candidate) => [candidate.id, candidate]));
  const recommendations = ranked.data.recommendations.slice(0, parsed.data.maxRecommendations).flatMap((ranking): MealRecommendationCard[] => {
    const candidate = byId.get(ranking.candidateId);
    if (!candidate) return [];
    let budgetImpact: ReturnType<typeof simulateBudgetImpact>;
    try {
      budgetImpact = dependencies.simulateBudgetImpact({ candidatePriceCents: ranking.estimatedPriceCents, financialContext: financial.data });
    } catch (error) {
      budgetImpact = { success: false, error: { code: "BUDGET_SIMULATION_ERROR", message: error instanceof Error ? error.message : "预算影响模拟失败" } };
    }
    return [recommendationCard(candidate, ranking, budgetImpact)];
  });
  const rankingMs = elapsed(rankingStartedAt);
  const pendingConfirmation = candidates.filter((candidate) => candidate.needsConfirmation);
  const status = recommendations.length > 0 ? "READY" : pendingConfirmation.length > 0 ? "NEEDS_PRICE_CONFIRMATION" : "NO_RECOMMENDATIONS";
  return {
    success: true,
    data: menuMealRecommendationResponseSchema.parse({
      runId, status, source: parsed.data.source.type, mealPeriod,
      ...(settings.defaultLocation ? { location: settings.defaultLocation } : {}),
      recognition: recognitionSummary(parsed.data.source.type, candidates, rejectedCandidateCount),
      pendingConfirmation, recommendations, rejectedCandidateCount,
      timing: { extractionMs, contextMs, rankingMs, totalMs: elapsed(startedAt) },
    }),
  };
}
