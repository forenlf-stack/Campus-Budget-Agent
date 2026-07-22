import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealAgentChatInputSchema, mealAgentChatResponseSchema } from "@/lib/meal-agent-chat";
import { centsToYuan, signedCentsToYuan } from "@/lib/money";
import { callDeepSeekMessagesJson, type DeepSeekMessage } from "@/server/llm/deepseek-client";
import { createSkillReadStore, type SkillReadStore } from "@/server/skill-read-store";
import { requireApiUser } from "@/server/auth";
import { getFinancialContext } from "@/server/skills/get-financial-context";
import { getRecentMealConsumption } from "@/server/skills/get-recent-meal-consumption";
import { parseMealRequest } from "@/server/skills/parse-meal-request";
import { retrieveHistoricalMealPatterns, type HistoricalMealPatternsData } from "@/server/skills/retrieve-historical-meal-patterns";

export const runtime = "nodejs";

const llmResponseSchema = z.object({
  reply: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  message: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  response: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  answer: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  analysis: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  conclusion: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters).optional(),
  referencedCandidateIds: z.array(z.string().trim().min(1)).max(agentCapabilities.mealRecommendations.maximumCount).default([]),
  suggestedRequest: z.string().trim().max(agentCapabilities.languageUnderstanding.maximumRequestCharacters).nullable().default(null),
  suggestedQuickTags: z.array(z.enum(["SAVE_MONEY", "TRY_DIFFERENT", "LIGHT", "SPICY", "STAY_NEAR"])).max(5).default([]),
  needsNewRecommendation: z.boolean().default(false),
}).passthrough().transform((value) => ({
  reply: value.reply ?? value.message ?? value.response ?? value.answer ?? value.analysis ?? value.conclusion ?? "",
  referencedCandidateIds: value.referencedCandidateIds,
  suggestedRequest: value.suggestedRequest,
  suggestedQuickTags: value.suggestedQuickTags,
  needsNewRecommendation: value.needsNewRecommendation,
})).refine((value) => value.reply.length > 0, { message: "Agent 未返回回复文本", path: ["reply"] });

function candidateContext(input: z.infer<typeof mealAgentChatInputSchema>) {
  return input.recommendations.map((item) => ({
    candidateId: item.candidateId,
    name: item.name,
    priceYuan: centsToYuan(item.priceCents),
    merchant: item.merchant,
    acquisition: item.acquisitionLabel,
    tags: item.shortTags,
    risk: item.risk,
    remainingBudgetAfterYuan: item.details.budgetImpact ? signedCentsToYuan(item.details.budgetImpact.remainingBudgetAfterCents) : null,
  }));
}

function localHistoryResponse(data: HistoricalMealPatternsData) {
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });
  const reply = data.patterns.length
    ? [
        `按你的本地账本统计，下面这些在近${data.recentDays}天吃过、但近${data.lookbackDays}天出现不超过2次：`,
        ...data.patterns.map((item, index) => {
          const name = item.name.slice(0, 60);
          const merchant = item.merchant && item.merchant !== item.name ? ` · ${item.merchant.slice(0, 50)}` : "";
          return `${index + 1}. ${name}${merchant}（${item.occurrenceCount}次，最近 ${dateFormatter.format(item.lastOccurredAt)}，净均价¥${centsToYuan(item.averageNetAmountCents)}）`;
        }),
        data.insufficientHistory ? "目前可用餐饮记录还不多，这份结果仅按现有流水统计。" : "这些结果只来自你的本地流水，并已排除全额退款和固定支出。",
      ].join("\n")
    : `本地账本里暂时没有找到“近${data.recentDays}天吃过、且近${data.lookbackDays}天不超过2次”的有效餐饮记录。可以先检查相关流水是否已归到“餐饮”分类。`;
  return mealAgentChatResponseSchema.parse({
    reply,
    referencedCandidateIds: [],
    suggestedRequest: null,
    suggestedQuickTags: [],
    needsNewRecommendation: false,
    source: "RULES",
  });
}

function fallbackResponse(input: z.infer<typeof mealAgentChatInputSchema>, reason: string, context: ReturnType<typeof agentContext>) {
  const parsed = parseMealRequest(input.message);
  const mentioned = input.recommendations.filter((item) => input.message.includes(item.name) || input.message.includes(item.candidateId));
  const needsNewRecommendation = parsed.quickTags.length > 0 || parsed.preferredTerms.length > 0 || parsed.avoidedTerms.length > 0
    || parsed.strictAvoidedTerms.length > 0 || parsed.hardPriceLimitCents !== undefined || parsed.targetPriceCents !== undefined;
  const asksForChoice = /(?:更推荐|推荐哪|选哪|哪个好|哪一个|二选一)/.test(input.message);
  const best = [...input.recommendations].sort((left, right) => right.details.totalScore - left.details.totalScore || left.priceCents - right.priceCents)[0];
  const asksPriceStandard = /(?:一顿饭|正餐).*(?:多少钱|价位|价格).*(?:合适|合理)|(?:多少钱|什么价位).*(?:合适|合理)/.test(input.message);
  const reply = asksForChoice && best
    ? `如果现在就选，我更推荐${best.name}：本地综合评分最高，价格为¥${centsToYuan(best.priceCents)}，${best.risk === "暂无明显风险" ? "目前没有明显风险" : `需要注意${best.risk}`}。`
    : asksPriceStandard
      ? `按你的当前设置，一顿正餐以¥${context.recommendedMealPriceYuan}左右较合适，¥${context.hardLimitYuan}以内通常仍可接受。你近14天最近几顿净均价约¥${context.recentAverageYuan}，可以把这个作为更贴近实际习惯的参考。`
      : mentioned.length
        ? `你提到的${mentioned.map((item) => item.name).join("、")}中，我会优先按价格、风险和当前预算给出明确判断。`
    : needsNewRecommendation
      ? "我已提取到新的筛选偏好，可以按这些条件重新计算一批推荐。"
      : `结合你当前剩余预算¥${context.remainingBudgetYuan}和近14天正餐净均价¥${context.recentAverageYuan}，我可以直接评价你提出的具体餐食、价格或在现有候选中替你做选择。`;
  return mealAgentChatResponseSchema.parse({
    reply,
    referencedCandidateIds: mentioned.map((item) => item.candidateId),
    suggestedRequest: needsNewRecommendation ? input.message : null,
    suggestedQuickTags: parsed.quickTags,
    needsNewRecommendation,
    source: "RULES",
    fallbackReason: reason,
  });
}

function agentContext(store: SkillReadStore) {
  const now = new Date();
  const financial = getFinancialContext({ queryDate: now }, store);
  const recent = getRecentMealConsumption({ queryDate: now, days: 14, recentCount: agentCapabilities.mealRecommendations.recentMealCount }, store);
  if (!financial.success) throw new Error(financial.error.message);
  if (!recent.success) throw new Error(recent.error.message);
  return {
    totalBudgetYuan: centsToYuan(financial.data.flexibleBudgetCents),
    spentYuan: signedCentsToYuan(financial.data.actualNetSpendingCents),
    remainingBudgetYuan: signedCentsToYuan(financial.data.remainingBudgetCents),
    recommendedMealPriceYuan: centsToYuan(financial.data.recommendedLunchPriceCents),
    hardLimitYuan: centsToYuan(financial.data.lunchHardLimitCents),
    recentDays: recent.data.days,
    recentMealCount: recent.data.mealCount,
    recentAverageYuan: centsToYuan(recent.data.recentAveragePriceCents),
    recentMeals: recent.data.recentMeals.map((item) => ({ name: item.name, priceYuan: centsToYuan(item.amountCents) })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = mealAgentChatInputSchema.parse(await request.json());
    const store = createSkillReadStore(user.id);
    const parsedRequest = parseMealRequest(input.message);
    if (parsedRequest.historyQuery === "RECENT_INFREQUENT") {
      const history = retrieveHistoricalMealPatterns({ queryDate: new Date() }, store);
      if (!history.success) throw new Error(history.error.message);
      return NextResponse.json(localHistoryResponse(history.data));
    }
    const context = agentContext(store);
    const system = `你是大学生的个人餐食决策 Agent，不是筛选条件解析器。你拥有用户当前预算、近期消费和可选候选等可信背景，应像了解用户情况的顾问一样直接回答。
个人背景中的 recentDays 是近期统计的唯一有效时间窗口；引用近期次数或均价时必须按该窗口表述，不得沿用历史消息中已经过时的时间口径。
用户可以询问合理餐价、提出候选库外的临时食物、描述一顿饭、让你比较候选，或要求你明确推荐一个。只要信息足够就必须给出判断，不要用“我可以继续比较”“请再告诉我”之类模板回避。
用户问“多少钱合适”时，给出建议价位、可接受上限和近期净均价。用户问某食物某价格能不能吃时，即使不在候选库，也要结合预算与近期消费评价“合适/偶尔可以/建议再想想”，但不要虚构其配料。
用户问“更推荐哪一个”时，必须从当前候选中明确点名一个，并说明价格、风险和主要理由，不得只说重新计算。
你可以讨论口味、价格、分量、获取方式和主观感受，不要把用户限制在快捷标签中。不得创造未提供的商家、价格、配料或预算数据。严格忌口、预算计算和最终记账由本地程序负责。
如果用户只是询问、比较或表达犹豫，直接回答，needsNewRecommendation=false。
只有用户明确要求“重新推荐、换一批、按新条件筛选”时，才设置 needsNewRecommendation=true。仅仅问“推荐哪一个”不需要重新计算。
referencedCandidateIds 只填写本次回答实际提到的候选。suggestedQuickTags 只能使用 SAVE_MONEY、TRY_DIFFERENT、LIGHT、SPICY、STAY_NEAR。
回答自然、简洁、有分析，不要只复述规则。只返回 JSON。`;
    const messages: DeepSeekMessage[] = [
      { role: "system", content: system },
      { role: "user", content: `可信的个人背景：\n${JSON.stringify(context)}` },
      { role: "user", content: `当前候选（这是可信的本地计算结果）：\n${JSON.stringify(candidateContext(input))}` },
      ...input.history.map((message) => ({ role: message.role, content: message.content }) satisfies DeepSeekMessage),
      { role: "user", content: input.message },
    ];
    try {
      const result = await callDeepSeekMessagesJson(messages, llmResponseSchema, { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" });
      const candidateIds = new Set(input.recommendations.map((item) => item.candidateId));
      return NextResponse.json(mealAgentChatResponseSchema.parse({
        ...result,
        referencedCandidateIds: result.referencedCandidateIds.filter((id) => candidateIds.has(id)),
        source: "LLM",
      }));
    } catch (error) {
      return NextResponse.json(fallbackResponse(input, error instanceof Error ? error.message : "模型响应不可用", context));
    }
  } catch (error) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "会话请求无效" } }, { status: 400 });
  }
}
