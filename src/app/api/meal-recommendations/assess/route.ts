import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mealPlanAssessmentInputSchema, mealPlanAssessmentResponseSchema } from "@/lib/meal-plan-assessment";
import { centsToYuan } from "@/lib/money";
import { callDeepSeekJson } from "@/server/llm/deepseek-client";
import { createSkillReadStore } from "@/server/skill-read-store";
import { requireApiUser } from "@/server/auth";
import { getFinancialContext } from "@/server/skills/get-financial-context";
import { getRecentMealConsumption } from "@/server/skills/get-recent-meal-consumption";
import { simulateBudgetImpact } from "@/server/skills/simulate-budget-impact";

export const runtime = "nodejs";

const copySchema = z.object({ reply: z.string().trim().min(1).max(800) }).passthrough();

const chineseDigits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(value: string): number {
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? chineseDigits[tens] ?? 0 : 1) * 10 + (ones ? chineseDigits[ones] ?? 0 : 0);
  }
  if (value.includes("百")) {
    const [hundreds, rest] = value.split("百");
    return (chineseDigits[hundreds] ?? 1) * 100 + (rest ? chineseNumber(rest) : 0);
  }
  return chineseDigits[value] ?? Number.NaN;
}

function extractPriceCents(description: string) {
  const matches = [...description.matchAll(/(?:总共|总价|一共|花了|价格|预算)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/g)];
  const match = matches.at(-1) ?? description.match(/(?:总共|总价|一共|花了|价格)?\s*(\d+(?:\.\d{1,2})?)\s*$/);
  const chineseMatch = description.match(/([一二两三四五六七八九十百]+)\s*(?:元|块)/);
  const yuan = match ? Number(match[1]) : chineseMatch ? chineseNumber(chineseMatch[1]) : Number.NaN;
  const cents = Math.round(yuan * 100);
  return Number.isFinite(yuan) && cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function isMealPlanAssessmentRequest(text: string) {
  return extractPriceCents(text) !== null && /(?:怎么样|合适|值不值|划算|能不能|可以吗|建议|评价|认为|准备吃|打算吃|这一顿|这顿)/.test(text);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const store = createSkillReadStore(user.id);
    const input = mealPlanAssessmentInputSchema.parse(await request.json());
    const priceCents = extractPriceCents(input.description);
    if (!priceCents) return NextResponse.json({ error: { code: "PRICE_REQUIRED", message: "请在描述中提供这顿饭的总价，例如“总共31元”" } }, { status: 400 });
    const now = new Date();
    const financial = getFinancialContext({ queryDate: now }, store);
    const recent = getRecentMealConsumption({ queryDate: now, days: 7, recentCount: 3 }, store);
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
      recent.data.mealCount > 0 ? `近7天正餐 ${recent.data.mealCount} 次，最近几次平均 ¥${centsToYuan(recent.data.recentAveragePriceCents)}` : "近7天暂无可比较的正餐记录",
      `购买后本月预算预计剩余 ¥${centsToYuan(impact.data.remainingBudgetAfterCents)}`,
    ];
    const facts = { userPlan: input.description, assessment: { level, title, reasons }, recentMeals: recent.data.recentMeals.map((item) => ({ name: item.name, priceYuan: centsToYuan(item.amountCents) })) };
    let reply = `${title}。${reasons.join("；")}。`;
    let source: "LLM" | "RULES" = "RULES";
    let fallbackReason: string | undefined;
    try {
      const copy = await callDeepSeekJson(
        "你是餐食方案评价 Agent。用户已经给出了想吃的具体方案和总价，不要另行推荐历史候选。根据可信事实评价口味结构、价格是否合适，并给出肯定、适度调整或再想想的建议。可以讨论荤素搭配、油辣程度和分量，但不得断言用户未提供的具体配料或营养数据，不得修改任何金额和等级。回复2到4句自然中文，只返回JSON，字段为reply。",
        JSON.stringify(facts),
        copySchema,
        { timeoutMs: 15_000, thinking: "disabled" },
      );
      reply = copy.reply; source = "LLM";
    } catch (error) { fallbackReason = error instanceof Error ? error.message : "模型响应不可用"; }
    return NextResponse.json(mealPlanAssessmentResponseSchema.parse({ level, title, reply, priceCents, recommendedMealPriceCents: financial.data.recommendedLunchPriceCents, recentAveragePriceCents: recent.data.recentAveragePriceCents, recentMealCount: recent.data.mealCount, remainingBudgetAfterCents: impact.data.remainingBudgetAfterCents, reasons, source, ...(fallbackReason ? { fallbackReason } : {}) }));
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "ASSESSMENT_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "方案评价失败" } }, { status: validation ? 400 : 500 });
  }
}
