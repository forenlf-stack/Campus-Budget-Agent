import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealRecommendationQuickTags } from "@/lib/meal-recommendations";
import type { SnackDecisionInput, SnackDecisionResponse } from "@/lib/snack-decisions";
import { callDeepSeekJson } from "./deepseek-client";

export const interpretedMealRequestSchema = z.object({
  quickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length).default([]),
  hardPriceLimitCents: z.coerce.number().int().positive().nullable().default(null),
  targetPriceCents: z.coerce.number().int().positive().nullable().default(null),
  preferredTerms: z.array(z.string().trim().min(1).max(agentCapabilities.languageUnderstanding.maximumTermCharacters))
    .max(agentCapabilities.languageUnderstanding.maximumPreferenceTerms).default([]),
  avoidedTerms: z.array(z.string().trim().min(1).max(agentCapabilities.languageUnderstanding.maximumTermCharacters))
    .max(agentCapabilities.languageUnderstanding.maximumPreferenceTerms).default([]),
  strictAvoidedTerms: z.array(z.string().trim().min(1).max(agentCapabilities.languageUnderstanding.maximumTermCharacters))
    .max(agentCapabilities.languageUnderstanding.maximumPreferenceTerms).default([]),
  understanding: z.string().trim().min(1).max(400),
  response: z.string().trim().min(1).max(600),
}).passthrough();

export type InterpretedMealRequest = z.infer<typeof interpretedMealRequestSchema>;

export async function interpretMealRequestWithLlm(text: string): Promise<InterpretedMealRequest | null> {
  if (!text.trim()) return null;
  return callDeepSeekJson(
    "你是餐食决策 Agent。完整理解用户的自然语言，不要把能力限制在快捷标签中。提取明确条件，但不得补充用户没说过的食物、价格或忌口。金额转换为整数分。只有用户明确表达过敏、绝对不能吃或严格禁忌时才写入 strictAvoidedTerms；普通的‘不太想吃、避开、少一点’写入 avoidedTerms，作为强偏好而不是安全阻断。quickTags只能使用 SAVE_MONEY, TRY_DIFFERENT, LIGHT, SPICY, STAY_NEAR，它们只是辅助信号。understanding说明你理解的目标和取舍；response说明将如何结合预算、偏好、地点和历史进行权衡。只返回JSON。",
    text,
    interpretedMealRequestSchema,
    { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
  );
}

export const organizedOcrMenuSchema = z.object({
  candidates: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    priceCents: z.coerce.number().int().positive().nullable().default(null),
    priceText: z.string().trim().min(1).nullable().default(null),
    description: z.string().trim().min(1).max(300).nullable().default(null),
    visibleTags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    confidence: z.number().min(0).max(1).default(0.75),
    rawTextReference: z.string().trim().min(1).max(500),
    needsConfirmation: z.boolean().default(false),
    risks: z.array(z.enum(["LOW_CONFIDENCE", "IMAGE_BLURRY", "PRICE_UNCERTAIN", "MEMBER_PRICE", "SET_PRICE"])).max(5).default([]),
  }).passthrough()).max(300),
}).passthrough();

export async function organizeOcrMenuTextWithLlm(ocrText: string) {
  return callDeepSeekJson(
    "你是外卖菜单OCR版面整理器。每行包含[x,y,w,h]坐标和文字。先按空间位置重建商品卡片：同一商品的菜名、描述和红色现价通常在相近y坐标，价格多在商品卡片右下区域。只保留明确可购买的完整菜品或套餐，不得创造图片中没有的商品。必须排除手机状态栏、VPN/网速、导航按钮、外送/自取、收藏、预订、拼单、广告、分类标题、销量、推荐语、选规格/选套餐按钮和孤立数字。禁止把单个汉字、价格的小数部分、件数、优惠金额当成菜品或价格。priceCents必须来自与菜名属于同一商品卡片的¥现价；例如¥24.9应为2490分。完整套餐与明确整套现价对应时直接使用整套价格，不拆分单品；神券价、券后价、补贴价或已含券价格也可作为当前价。只有起售价、会员资格价、多规格或无法可靠关联菜名和价格时，priceCents为null且needsConfirmation=true。rawTextReference应合并引用对应菜名和价格证据。只返回JSON。",
    ocrText,
    organizedOcrMenuSchema,
    { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
  );
}

const snackCopySchema = z.object({
  agentComment: z.string().trim().min(1).max(800),
  additionalAlternatives: z.array(z.string().trim().min(1).max(160)).max(3).default([]),
}).passthrough();

export async function explainSnackDecisionWithLlm(input: SnackDecisionInput, deterministic: SnackDecisionResponse) {
  const facts = { item: input, decision: deterministic };
  const copy = await callDeepSeekJson(
    "你是大学生零食饮料消费决策 Agent。根据给定的本地判断、商品名称与商家、近7天和前7天消费、近期平均单价、周偏好余量及总预算，给出自然、温和且具体的点评。明确回答为什么可以买、为什么适合少买一点或为什么建议暂缓。可以补充最多3条与当前场景相关、不会虚构价格的替代做法到 additionalAlternatives。不得改变 level、recommendation、title、reasons 或任何金额/次数，不得声称查询了外部价格，不要说教或制造焦虑。只返回JSON。",
    JSON.stringify(facts),
    snackCopySchema,
    { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
  );
  return {
    ...deterministic,
    alternatives: [...new Set([...deterministic.alternatives, ...copy.additionalAlternatives])].slice(0, 5),
    agentComment: copy.agentComment,
    agentSource: "LLM" as const,
  };
}
