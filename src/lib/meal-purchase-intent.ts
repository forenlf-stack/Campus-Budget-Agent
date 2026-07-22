import { z } from "zod";

import { parseMentionedPriceCents } from "./meal-input-routing";

export const mealPurchaseDraftSchema = z.object({
  itemName: z.string().trim().min(1).max(100),
  actualPriceCents: z.number().int().safe().positive().nullable(),
}).strict();

export type MealPurchaseDraft = z.infer<typeof mealPurchaseDraftSchema>;

const completedPurchasePattern = /(?:我|已经|刚刚?|刚才)?\s*(?:买了|点了|下单了|支付了|付款了|吃了)/;
const negativeOrFuturePattern = /(?:没买|没有买|还没买|没点|没有点|还没点|不买了|不点了|想买|想点|准备买|准备点|打算买|打算点)/;
const priceTextPattern = /(?:[¥￥]\s*)?\d+(?:\.\d{1,2})?\s*(?:元|块)(?:\s*\d{1,2})?|[零〇一二两三四五六七八九十百千]+\s*(?:元|块)(?:\s*[零〇一二两三四五六七八九]{1,2})?/g;

export function parseCompletedMealPurchase(message: string): MealPurchaseDraft | null {
  const normalized = message.trim();
  if (!completedPurchasePattern.test(normalized) || negativeOrFuturePattern.test(normalized)) return null;

  const completedMatch = normalized.match(completedPurchasePattern);
  let remainder = normalized.slice((completedMatch?.index ?? 0) + (completedMatch?.[0].length ?? 0));
  remainder = remainder
    .replace(/^\s*(?:一份|一个|一顿|一碗|一盒|一套)\s*/, "")
    .replace(priceTextPattern, " ")
    .replace(/^\s*的\s*/, "")
    .replace(/\s*的\s*$/, "")
    .trim();
  const itemName = remainder
    .split(/[，,。；;！!？?]/, 1)[0]
    .replace(/(?:尝试|试试|尝尝|吃吃|看看)(?:一下)?$/, "")
    .replace(/^(?:的|了)\s*/, "")
    .replace(/\s*(?:的|了)$/, "")
    .trim();
  if (!itemName) return null;

  return mealPurchaseDraftSchema.parse({
    itemName,
    actualPriceCents: parseMentionedPriceCents(normalized),
  });
}
