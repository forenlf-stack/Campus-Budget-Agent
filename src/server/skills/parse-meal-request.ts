import type { MealRecommendationQuickTag } from "@/lib/meal-recommendations";

export interface ParsedMealRequest {
  quickTags: MealRecommendationQuickTag[];
  hardPriceLimitCents?: number;
  preferredTerms: string[];
  avoidedTerms: string[];
}

const preferencePatterns = [
  /(?:想吃|想要|来点|推荐)([^，。,.！!？?]{1,12})/g,
];
const avoidancePattern = /(?:不要|不吃|忌口|避开)([^，。,.！!？?]{1,12})/g;

function capturedTerms(text: string, patterns: RegExp[]) {
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]?.trim()).filter((term): term is string => Boolean(term)));
}

export function parseMealRequest(value: string): ParsedMealRequest {
  const text = value.trim();
  const quickTags: MealRecommendationQuickTag[] = [];
  if (/省|便宜|实惠|性价比/.test(text)) quickTags.push("SAVE_MONEY");
  if (/换.{0,2}(口味|一批)|不一样|新鲜/.test(text)) quickTags.push("TRY_DIFFERENT");
  if (/清淡|少油|低脂|健康/.test(text)) quickTags.push("LIGHT");
  if (/(想吃|要|喜欢).{0,3}辣/.test(text) && !/(不要|不吃|不能吃|忌).{0,3}辣/.test(text)) quickTags.push("SPICY");
  if (/近一点|不想走远|附近|就近|外卖|配送/.test(text)) quickTags.push("STAY_NEAR");

  const price = text.match(/(?:不超过|最多|控制在|预算|人均)?\s*(\d+(?:\.\d{1,2})?)\s*元?(?:以内|以下|左右)?/);
  const yuan = price ? Number(price[1]) : Number.NaN;
  const hardPriceLimitCents = Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : undefined;
  const preferredTerms = capturedTerms(text, preferencePatterns)
    .map((term) => term.replace(/(?:的|一点|一些|吧)$/, "").trim())
    .filter(Boolean);
  const avoidedTerms = capturedTerms(text, [avoidancePattern])
    .map((term) => term.replace(/(?:的|食物|食品)$/, "").trim())
    .filter(Boolean);

  return {
    quickTags: [...new Set(quickTags)],
    ...(hardPriceLimitCents ? { hardPriceLimitCents } : {}),
    preferredTerms: [...new Set(preferredTerms)],
    avoidedTerms: [...new Set(avoidedTerms)],
  };
}
