import { z } from "zod";

import { mealRecommendationQuickTags } from "@/lib/meal-recommendations";
import type { SnackDecisionInput, SnackDecisionResponse } from "@/lib/snack-decisions";
import { callDeepSeekJson } from "./deepseek-client";

export const interpretedMealRequestSchema = z.object({
  quickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length).default([]),
  hardPriceLimitCents: z.coerce.number().int().positive().nullable().default(null),
  preferredTerms: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  avoidedTerms: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  understanding: z.string().trim().min(1).max(160),
  response: z.string().trim().min(1).max(240),
}).passthrough();

export type InterpretedMealRequest = z.infer<typeof interpretedMealRequestSchema>;

export async function interpretMealRequestWithLlm(text: string): Promise<InterpretedMealRequest | null> {
  if (!text.trim()) return null;
  return callDeepSeekJson(
    "你是餐食决策Agent。先简短回应用户，再提取明确条件。不得补充用户没说过的食物、价格或忌口。金额转换为整数分。quickTags只能使用 SAVE_MONEY, TRY_DIFFERENT, LIGHT, SPICY, STAY_NEAR。understanding用一句话说明你理解的需求；response用一句话说明将如何结合预算、偏好和历史筛选。只返回JSON。",
    text,
    interpretedMealRequestSchema,
    { timeoutMs: 15_000, thinking: "disabled" },
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
  }).passthrough()).max(100),
}).passthrough();

export async function organizeOcrMenuTextWithLlm(ocrText: string) {
  return callDeepSeekJson(
    "你是外卖菜单OCR版面整理器。每行包含[x,y,w,h]坐标和文字。先按空间位置重建商品卡片：同一商品的菜名、描述和红色现价通常在相近y坐标，价格多在商品卡片右下区域。只保留明确可购买的完整菜品或套餐，不得创造图片中没有的商品。必须排除手机状态栏、VPN/网速、导航按钮、外送/自取、收藏、预订、拼单、广告、分类标题、销量、推荐语、选规格/选套餐按钮和孤立数字。禁止把单个汉字、价格的小数部分、件数、优惠金额当成菜品或价格。priceCents必须来自与菜名属于同一商品卡片的¥现价；例如¥24.9应为2490分。完整套餐与明确整套现价对应时直接使用整套价格，不拆分单品；神券价、券后价、补贴价或已含券价格也可作为当前价。只有起售价、会员资格价、多规格或无法可靠关联菜名和价格时，priceCents为null且needsConfirmation=true。rawTextReference应合并引用对应菜名和价格证据。只返回JSON。",
    ocrText,
    organizedOcrMenuSchema,
    { timeoutMs: 15_000, thinking: "disabled" },
  );
}

const snackCopySchema = z.object({ agentComment: z.string().trim().min(1).max(500) }).passthrough();

export async function explainSnackDecisionWithLlm(input: SnackDecisionInput, deterministic: SnackDecisionResponse) {
  const facts = { item: input, decision: deterministic };
  const copy = await callDeepSeekJson(
    "你是大学生零食饮料消费决策Agent。根据给定的本地判断、近7天与前7天消费、近期平均单价、周偏好余量和总预算，用2到4句自然、温和的中文点评这次购买。明确回答为什么可以买、为什么适合少买一点或为什么建议暂缓。不得改变level、recommendation、title、reasons、alternatives或任何金额/次数，不得声称查询了外部价格，不要说教或制造焦虑。只返回JSON，字段为agentComment。",
    JSON.stringify(facts),
    snackCopySchema,
  );
  return { ...deterministic, agentComment: copy.agentComment, agentSource: "LLM" as const };
}
