import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealPlanAssessmentInputSchema, mealPlanAssessmentResponseSchema } from "@/lib/meal-plan-assessment";
import { parseMentionedPriceCents } from "@/lib/meal-input-routing";
import { centsToYuan, signedCentsToYuan } from "@/lib/money";
import { callDeepSeekJson } from "@/server/llm/deepseek-client";
import { createSkillReadStore } from "@/server/skill-read-store";
import { requireApiUser } from "@/server/auth";
import { getFinancialContext } from "@/server/skills/get-financial-context";
import { getRecentMealConsumption } from "@/server/skills/get-recent-meal-consumption";
import { simulateBudgetImpact } from "@/server/skills/simulate-budget-impact";

export const runtime = "nodejs";

const unsupportedAssessmentClaims = /(?:配料|食材|荤素|油腻|油润|清淡|辣度|辛辣|营养|热量|蛋白质|维生素|蔬菜|肉类|鱼类|豆制品|鸡肉类|口味结构|膳食)/;
const copySchema = z.object({
  reply: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters)
    .refine((reply) => !unsupportedAssessmentClaims.test(reply), "模型回复包含本地事实无法支持的餐食断言"),
}).strict();

export function isMealPlanAssessmentRequest(text: string) {
  return parseMentionedPriceCents(text) !== null && /(?:怎么样|合适|值不值|划算|能不能|可以吗|建议|评价|认为|准备吃|打算吃|这一顿|这顿)/.test(text);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const store = createSkillReadStore(user.id);
    const input = mealPlanAssessmentInputSchema.parse(await request.json());
    const priceCents = parseMentionedPriceCents(input.description);
    if (!priceCents) return NextResponse.json({ error: { code: "PRICE_REQUIRED", message: "请在描述中提供这顿饭的总价，例如“总共31元”" } }, { status: 400 });
    const now = new Date();
    const financial = getFinancialContext({ queryDate: now }, store);
    const recent = getRecentMealConsumption({ queryDate: now, days: 14, recentCount: agentCapabilities.mealRecommendations.recentMealCount }, store);
    if (!financial.success) throw new Error(financial.error.message);
    if (!recent.success) throw new Error(recent.error.message);
    const impact = simulateBudgetImpact({ candidatePriceCents: priceCents, financialContext: financial.data });
    if (!impact.success) throw new Error(impact.error.message);

    const aboveRecommended = priceCents > financial.data.recommendedLunchPriceCents;
    const wellAboveRecommended = priceCents * 100 > financial.data.recommendedLunchPriceCents * 140;
    const aboveRecentAverage = recent.data.recentAveragePriceCents > 0 && priceCents > recent.data.recentAveragePriceCents;
    const level = impact.data.remainingBudgetAfterCents < 0 || (wellAboveRecommended && recent.data.highRecentPriceTriggered)
      ? "RECONSIDER" as const
      : aboveRecommended || aboveRecentAverage
        ? "CAUTION" as const
        : "POSITIVE" as const;
    const title = level === "POSITIVE" ? "这顿整体合适" : level === "CAUTION" ? "可以吃，但价格偏高" : "建议再想想或适当减量";
    const reasons = [
      `本次总价 ¥${centsToYuan(priceCents)}，建议正餐价约 ¥${centsToYuan(financial.data.recommendedLunchPriceCents)}`,
      recent.data.mealCount > 0 ? `近14天正餐 ${recent.data.mealCount} 次，最近几次净均价 ¥${centsToYuan(recent.data.recentAveragePriceCents)}` : "近14天暂无可比较的正餐记录",
      `购买后本月预算预计剩余 ¥${signedCentsToYuan(impact.data.remainingBudgetAfterCents)}`,
    ];
    const facts = { assessment: { level, title, reasons } };
    let reply = `${title}。${reasons.join("；")}。`;
    let source: "LLM" | "RULES" = "RULES";
    let fallbackReason: string | undefined;
    try {
      const copy = await callDeepSeekJson(
        "你是餐食价格与预算评价 Agent。只能复述输入 JSON 中 assessment 已明确给出的价格、近14天次数与净均价、预算结果、等级和标题，并据此给出肯定、适度控制价格或再想想的建议。不得评价或猜测配料、食材、荤素、油辣、营养、热量、口味结构、分量或近期吃过的具体食材；不得补充任何输入中没有的事实，不得修改任何金额、时间范围和等级，不得另行推荐餐食。回复2到4句自然中文，只返回严格 JSON 对象，且只能有 reply 字段。",
        JSON.stringify(facts),
        copySchema,
        { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
      );
      reply = copy.reply; source = "LLM";
    } catch (error) { fallbackReason = error instanceof Error ? error.message : "模型响应不可用"; }
    return NextResponse.json(mealPlanAssessmentResponseSchema.parse({ level, title, reply, priceCents, recommendedMealPriceCents: financial.data.recommendedLunchPriceCents, recentAveragePriceCents: recent.data.recentAveragePriceCents, recentMealCount: recent.data.mealCount, remainingBudgetAfterCents: impact.data.remainingBudgetAfterCents, reasons, source, ...(fallbackReason ? { fallbackReason } : {}) }));
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "ASSESSMENT_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "方案评价失败" } }, { status: validation ? 400 : 500 });
  }
}
