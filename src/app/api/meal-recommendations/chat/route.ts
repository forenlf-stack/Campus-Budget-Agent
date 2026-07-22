import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealAgentChatInputSchema, mealAgentChatResponseSchema } from "@/lib/meal-agent-chat";
import { parseCompletedMealPurchase, type MealPurchaseDraft } from "@/lib/meal-purchase-intent";
import { centsToYuan, signedCentsToYuan } from "@/lib/money";
import { callDeepSeekJson, callDeepSeekMessagesJson, type DeepSeekMessage } from "@/server/llm/deepseek-client";
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

const priceAdviceText = z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters);
const priceAdviceCopySchema = z.object({
  reply: priceAdviceText.optional(),
  message: priceAdviceText.optional(),
  response: priceAdviceText.optional(),
  answer: priceAdviceText.optional(),
}).passthrough().transform((value) => ({
  reply: value.reply ?? value.message ?? value.response ?? value.answer ?? "",
})).refine((value) => value.reply.length > 0, { message: "Agent 未返回价格分析文本", path: ["reply"] });

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

function localPurchaseDraftResponse(draft: MealPurchaseDraft) {
  const amount = draft.actualPriceCents === null
    ? "金额还没有识别出来，请在确认窗口补充"
    : `金额为¥${centsToYuan(draft.actualPriceCents)}`;
  return mealAgentChatResponseSchema.parse({
    reply: `听起来你已经购买了${draft.itemName}，${amount}。我已准备好记账确认信息，请核对餐食、金额和时间；只有再次确认后才会写入账本。`,
    referencedCandidateIds: [],
    suggestedRequest: null,
    suggestedQuickTags: [],
    needsNewRecommendation: false,
    source: "RULES",
    purchaseDraft: draft,
  });
}

function isPriceAdviceRequest(message: string) {
  return /(?:价格|价位|预算|多少钱).{0,10}(?:建议|合适|合理)|(?:建议|合适|合理).{0,10}(?:价格|价位|预算)/.test(message);
}

function localPriceAdviceResponse(
  input: z.infer<typeof mealAgentChatInputSchema>,
  context: ReturnType<typeof agentContext>,
) {
  const parsed = parseMealRequest(input.message);
  const subject = parsed.preferredTerms[0] || "这顿饭";
  const matchingCandidate = input.recommendations.find((item) => `${item.name} ${item.merchant}`.includes(subject));
  const comparison = matchingCandidate
    ? `当前候选中的${matchingCandidate.name}是¥${centsToYuan(matchingCandidate.priceCents)}，可以直接拿这个区间比较。`
    : input.recommendations.length > 0
      ? `当前页面的候选里没有${subject}，所以下方卡片只能作为价格参照，不代表${subject}推荐。`
      : `当前没有可直接比较的${subject}候选，所以这里只给出价格区间。`;
  const reply = `如果想吃${subject}，按你当前设置，建议把这一顿控制在¥${context.recommendedMealPriceYuan}左右；¥${context.hardLimitYuan}以内可以偶尔接受。你近${context.recentDays}天正餐净均价约¥${context.recentAverageYuan}，如果只是普通一人份，优先找建议价附近的选择会更稳妥。${comparison}`;
  return mealAgentChatResponseSchema.parse({
    reply,
    referencedCandidateIds: matchingCandidate ? [matchingCandidate.candidateId] : [],
    suggestedRequest: null,
    suggestedQuickTags: [],
    needsNewRecommendation: false,
    source: "RULES",
  });
}

function mentionedMoneyCents(reply: string) {
  return [...reply.matchAll(/(?:[¥￥]\s*([+-]?\d+(?:\.\d{1,2})?)|([+-]?\d+(?:\.\d{1,2})?)\s*(?:元|块))/g)]
    .map((match) => Math.round(Number(match[1] ?? match[2]) * 100));
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function priceAdviceSemanticProblems(
  reply: string,
  subject: string,
  matchingCandidate: z.infer<typeof mealAgentChatInputSchema>["recommendations"][number] | undefined,
  allowedMoneyCents: Set<number>,
) {
  const problems: string[] = [];
  if (mentionedMoneyCents(reply).some((cents) => !allowedMoneyCents.has(cents))) problems.push("包含本地事实之外的金额");
  if (subject !== "这顿饭" && !reply.includes(subject)) problems.push("遗漏用户询问的餐食主题");
  if (!matchingCandidate && !/(?:没有|暂无).{0,16}(?:候选|可比较)|(?:候选|可比较).{0,10}(?:没有|暂无)/.test(reply)) {
    problems.push("没有说明当前不存在可直接比较的该类候选");
  }
  if (subject !== "这顿饭") {
    const escapedSubject = escapedPattern(subject);
    if (new RegExp(`(?:配置|设置).{0,10}${escapedSubject}|${escapedSubject}.{0,8}(?:建议餐价|价格设置)`).test(reply)) {
      problems.push("把通用正餐建议价错误描述成具体品类的配置价格");
    }
  }
  if (/(?:市场价|通常售价|一般卖|普遍价格)/.test(reply)) problems.push("虚构了未提供的市场价格");
  if (/(?:经常|多数|大部分|频繁|多次).{0,8}(?:超过|超出|高于)/.test(reply)) {
    problems.push("仅凭均价推断了消费超限频率");
  }
  return problems;
}

function repairPriceAdviceFacts(
  reply: string,
  subject: string,
  matchingCandidate: z.infer<typeof mealAgentChatInputSchema>["recommendations"][number] | undefined,
  recommendedMealPriceYuan: string,
) {
  let repaired = reply;
  const recommendedNumber = Number(recommendedMealPriceYuan);
  const recommendedPattern = Number.isInteger(recommendedNumber)
    ? `${recommendedNumber}(?:\\.0{1,2})?`
    : escapedPattern(recommendedMealPriceYuan);
  repaired = repaired
    .replace(new RegExp(`控制在\\s*${recommendedPattern}\\s*元以内`, "g"), `控制在${recommendedMealPriceYuan}元左右`)
    .replace(new RegExp(`(?:最好|尽量)?不要超过\\s*${recommendedPattern}\\s*元`, "g"), `尽量贴近${recommendedMealPriceYuan}元`);
  if (subject !== "这顿饭") {
    const escapedSubject = escapedPattern(subject);
    repaired = repaired
      .replace(new RegExp(`(?:配置|设置)(?:的)?${escapedSubject}(?=建议餐价|价格设置)`, "g"), "配置的正餐")
      .replace(new RegExp(`${escapedSubject}(?=建议餐价|价格设置)`, "g"), "正餐")
      .replace(new RegExp(`(?:目前|当前)?没有你?(?:近期|最近)(?:的)?${escapedSubject}候选记录`, "g"), `当前没有可直接比较的${subject}候选`);
  }
  repaired = repaired.replace(/(?:经常|多数|大部分|频繁|多次).{0,4}(?:超过|超出|高于)/g, "近期净均价高于");
  if (!matchingCandidate && !/(?:没有|暂无).{0,16}(?:候选|可比较)|(?:候选|可比较).{0,10}(?:没有|暂无)/.test(repaired)) {
    repaired = `${repaired.replace(/[。；;\s]+$/, "")}。${subject === "这顿饭" ? "当前没有可直接比较的候选餐食。" : `当前没有可直接比较的${subject}候选。`}`;
  }
  return repaired;
}

async function priceAdviceResponse(
  input: z.infer<typeof mealAgentChatInputSchema>,
  context: ReturnType<typeof agentContext>,
) {
  const fallback = localPriceAdviceResponse(input, context);
  const parsed = parseMealRequest(input.message);
  const subject = parsed.preferredTerms[0] || "这顿饭";
  const matchingCandidate = input.recommendations.find((item) => `${item.name} ${item.merchant}`.includes(subject));
  const facts = {
    userQuestion: input.message,
    subject,
    configuredRecommendedMealPriceYuan: context.recommendedMealPriceYuan,
    configuredAcceptableUpperLimitYuan: context.hardLimitYuan,
    recentWindowDays: context.recentDays,
    recentMealCount: context.recentMealCount,
    recentNetAverageYuan: context.recentAverageYuan,
    remainingBudgetYuan: context.remainingBudgetYuan,
    remainingDays: context.remainingDays,
    recommendedDailyBudgetYuan: context.recommendedDailyBudgetYuan,
    matchingCandidate: matchingCandidate ? {
      name: matchingCandidate.name,
      priceYuan: centsToYuan(matchingCandidate.priceCents),
      risk: matchingCandidate.risk,
    } : null,
  };
  const system = `你是餐食价格分析 Agent。根据输入的本地可信事实回答用户当前问题，而不是复述固定模板。
必须区分“用户配置的建议餐价”“可接受上限”“近期实际净均价”和“剩余预算”，解释它们为什么可能不同，并给出今天这一顿的明确结论。
configuredRecommendedMealPriceYuan 和 configuredAcceptableUpperLimitYuan 是所有正餐共用的用户设置，绝不是咖喱、日料或其他具体品类的配置价格。只能称为“正餐建议价”或“通用正餐建议价”。
只能使用输入 JSON 中的事实和金额；不得补充市场价格、商家、菜品、配料、营养或用户没有提供的偏好。不得把近期净均价误说成建议价。
若 matchingCandidate 为 null，必须说明当前没有可直接比较的该类候选，不能声称已经推荐到它；若不为 null，可以评价该候选价格。
这只是价格分析，不得触发重新推荐，不得声称已经记账或购买。用自然、连贯的第二人称中文回复2到4句。
只返回严格 JSON 对象，且只能包含 reply 字段。`;
  const allowedMoneyCents = new Set([
    context.recommendedMealPriceYuan,
    context.hardLimitYuan,
    context.recentAverageYuan,
    context.remainingBudgetYuan,
    context.recommendedDailyBudgetYuan,
    ...(matchingCandidate ? [centsToYuan(matchingCandidate.priceCents)] : []),
  ].map((yuan) => Math.round(Number(yuan) * 100)));
  try {
    let previousReply = "";
    let previousProblems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const modelInput = attempt === 0
        ? facts
        : { ...facts, correction: { previousReply, problems: previousProblems, instruction: "针对问题逐项修正，不得重复原错误。" } };
      const copy = await callDeepSeekJson(system, JSON.stringify(modelInput), priceAdviceCopySchema, {
        timeoutMs: agentCapabilities.model.defaultTimeoutMs,
        thinking: "enabled",
      });
      const repairedReply = repairPriceAdviceFacts(copy.reply, subject, matchingCandidate, context.recommendedMealPriceYuan);
      const problems = priceAdviceSemanticProblems(repairedReply, subject, matchingCandidate, allowedMoneyCents);
      if (problems.length === 0) {
        return mealAgentChatResponseSchema.parse({
          ...fallback,
          reply: repairedReply,
          source: "LLM",
          fallbackReason: undefined,
        });
      }
      previousReply = repairedReply;
      previousProblems = problems;
    }
    throw new Error(`模型价格分析未通过事实校验：${previousProblems.join("；")}`);
  } catch (error) {
    return mealAgentChatResponseSchema.parse({
      ...fallback,
      source: "RULES",
      fallbackReason: error instanceof Error ? error.message : "模型价格分析不可用",
    });
  }
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
    remainingDays: financial.data.remainingDays,
    recommendedDailyBudgetYuan: centsToYuan(financial.data.recommendedDailyBudgetCents),
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
    const purchaseDraft = parseCompletedMealPurchase(input.message);
    if (purchaseDraft) {
      return NextResponse.json(localPurchaseDraftResponse(purchaseDraft));
    }
    if (parsedRequest.historyQuery === "RECENT_INFREQUENT") {
      const history = retrieveHistoricalMealPatterns({ queryDate: new Date() }, store);
      if (!history.success) throw new Error(history.error.message);
      return NextResponse.json(localHistoryResponse(history.data));
    }
    const context = agentContext(store);
    if (isPriceAdviceRequest(input.message)) {
      return NextResponse.json(await priceAdviceResponse(input, context));
    }
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
