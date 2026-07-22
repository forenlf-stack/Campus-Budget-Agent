import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  directMealRecommendationInputSchema,
  directMealRecommendationResponseSchema,
  mealRecommendationReasonLabel,
  mealRecommendationRiskLabel,
  type MealRecommendationCard,
} from "@/lib/meal-recommendations";
import { runFixedMealRecommendation } from "@/server/workflows/fixed-meal-recommendation";
import { interpretMealRequestWithLlm } from "@/server/llm/agent-reasoning";
import { mergeMealRequests, parseMealRequest } from "@/server/skills/parse-meal-request";
import { requireApiUser } from "@/server/auth";
import { createSkillReadStore } from "@/server/skill-read-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const user = await requireApiUser();
    const text = await request.text();
    const input = directMealRecommendationInputSchema.parse(text ? JSON.parse(text) : {});
    let interpretedRequest = null;
    let agentResponse: { understanding: string; response: string; source: "LLM" | "RULES"; fallbackReason?: string } | null = null;
    let llmFallbackReason = "";
    if (!input.skipAgentInterpretation) {
      try {
        interpretedRequest = await interpretMealRequestWithLlm(input.userRequest);
        if (interpretedRequest) agentResponse = { understanding: interpretedRequest.understanding, response: interpretedRequest.response, source: "LLM" };
      } catch (error) { llmFallbackReason = error instanceof Error ? error.message : "模型响应不可用"; }
    }
    if (!agentResponse && input.userRequest) {
      const fallback = parseMealRequest(input.userRequest);
      const conditions = [
        fallback.hardPriceLimitCents ? `${fallback.hardPriceLimitCents / 100}元以内` : "",
        fallback.targetPriceCents ? `${fallback.targetPriceCents / 100}元左右` : "",
        ...fallback.preferredTerms,
        ...fallback.avoidedTerms.map((item) => `尽量避开${item}`),
        ...fallback.strictAvoidedTerms.map((item) => `严格避开${item}`),
      ].filter(Boolean);
      agentResponse = { understanding: conditions.length ? `我理解你的重点是：${conditions.join("、")}。` : `我会按“${input.userRequest}”筛选。`, response: "我会结合当前总预算、口味偏好、地点和近期饮食记录给出候选。", source: "RULES", ...(llmFallbackReason ? { fallbackReason: llmFallbackReason } : {}) };
    }
    const workflowInput = { quickTags: input.quickTags, excludeCandidateIds: input.excludeCandidateIds, userRequest: input.userRequest, maxRecommendations: input.maxRecommendations };
    const result = runFixedMealRecommendation({ ...workflowInput, interpretedRequest }, { store: createSkillReadStore(user.id) });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (!result.success) return NextResponse.json({ error: result.error, durationMs }, { status: result.error.code === "INVALID_INPUT" ? 400 : 500 });

    const executionSteps = result.data.executionSteps.map(({ step, status }) => ({ step, status }));
    const localRequest = parseMealRequest(input.userRequest);
    const effectiveRequest = interpretedRequest
      ? mergeMealRequests(localRequest, interpretedRequest, input.userRequest)
      : localRequest;
    const meaningfulPreferredTerms = effectiveRequest.preferredTerms.filter((term) => !/^(?:饭|餐|菜|食物|东西)$/.test(term));
    const hasExactPreferredCandidate = meaningfulPreferredTerms.length === 0 || result.data.recommendations.some(({ candidate }) => {
      const searchable = [candidate.name, candidate.merchant, candidate.location, ...candidate.tags].join(" ").toLowerCase();
      return meaningfulPreferredTerms.some((term) => searchable.includes(term.toLowerCase()));
    });
    if (agentResponse && !hasExactPreferredCandidate) {
      agentResponse = {
        ...agentResponse,
        response: `当前候选库暂时没有包含“${meaningfulPreferredTerms.join("、")}”的选项；下面展示的是符合价格和其他条件的备选，并非该类餐食。`,
      };
    }
    const recommendations: MealRecommendationCard[] = result.data.recommendations.map(({ candidate, ranking, budgetImpact }) => ({
      candidateId: candidate.id,
      name: candidate.name,
      merchant: candidate.merchant,
      acquisitionLabel: [...candidate.tags, candidate.location].some((value) => /外卖|配送/.test(value)) ? "外卖" : candidate.location,
      priceCents: candidate.typicalPriceCents,
      recommendationType: ranking.recommendationType,
      shortTags: ranking.reasons.slice(0, 3).map(mealRecommendationReasonLabel),
      risk: ranking.risks.length ? mealRecommendationRiskLabel(ranking.risks[0]) : "暂无明显风险",
      actionLabel: "选这个",
      details: {
        totalScore: ranking.totalScore,
        scoreBreakdown: ranking.scoreBreakdown,
        budgetImpact: budgetImpact ? {
          remainingBudgetAfterCents: budgetImpact.remainingBudgetAfterCents,
          mealRemainingAfterCents: budgetImpact.mealRemainingAfterCents,
          recommendedDailyBudgetAfterCents: budgetImpact.recommendedDailyBudgetAfterCents,
          savingsTargetStillOnTrack: budgetImpact.savingsTargetStillOnTrack,
        } : null,
        executionSteps,
      },
    }));
    const responseData = directMealRecommendationResponseSchema.parse({
      runId: result.data.runId,
      status: result.data.status,
      mealPeriod: result.data.mealPeriod,
      ...(result.data.location
        ? { location: result.data.location }
        : {}),
      recommendations,
      agentResponse,
      durationMs,
      ...(result.data.emptyResultReason
        ? { emptyResultReason: result.data.emptyResultReason }
        : {}),
    });

    return NextResponse.json(responseData);
  } catch (error) {
    const validation = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "MEAL_RECOMMENDATION_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "推荐失败" }, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 }, { status: validation ? 400 : 500 });
  }
}
