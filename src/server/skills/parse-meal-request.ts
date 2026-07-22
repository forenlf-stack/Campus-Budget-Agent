import type { MealRecommendationQuickTag } from "@/lib/meal-recommendations";

export interface ParsedMealRequest {
  quickTags: MealRecommendationQuickTag[];
  historyQuery: "RECENT_INFREQUENT" | null;
  hardPriceLimitCents?: number;
  targetPriceCents?: number;
  preferredTerms: string[];
  avoidedTerms: string[];
  strictAvoidedTerms: string[];
}

export interface ModelMealRequest {
  quickTags: MealRecommendationQuickTag[];
  hardPriceLimitCents: number | null;
  targetPriceCents: number | null;
  preferredTerms: string[];
  avoidedTerms: string[];
  strictAvoidedTerms: string[];
}

const preferencePatterns = [/(?:想吃|想要|来点|推荐)([^，。,.！!？?]{1,30})/g];
const avoidancePattern = /(?:不太想吃|不太想要|不怎么想吃|不想吃|少一点|不要|避开)([^，。,.！!？?]{1,30})/g;
const strictAvoidancePatterns = [
  /(?:我)?对([^，。,.！!？?]{1,30})过敏/g,
  /(?:^|[，。,.！!？?\s])(?!我?对)([^，。,.！!？?\s]{1,30})过敏/g,
  /(?:过敏于|不能吃|绝对不吃|严禁|忌口)([^，。,.！!？?]{1,30})/g,
];

const termAliases = new Map<string, string>([
  ["peanut", "花生"], ["peanuts", "花生"],
  ["sesame", "芝麻"],
  ["cilantro", "香菜"], ["coriander", "香菜"],
  ["milk", "牛奶"], ["dairy", "乳制品"], ["lactose", "乳糖"],
  ["egg", "鸡蛋"], ["eggs", "鸡蛋"],
  ["gluten", "麸质"], ["shellfish", "贝类"], ["seafood", "海鲜"],
]);

function capturedTerms(text: string, patterns: RegExp[]) {
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)]
    .map((match) => match[1]?.trim())
    .filter((term): term is string => Boolean(term)));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function termFromUserText(originalText: string, modelTerm: string) {
  const trimmed = modelTerm.trim();
  if (!trimmed) return null;
  const canonical = termAliases.get(trimmed.toLocaleLowerCase("en-US")) ?? trimmed;
  return originalText.toLocaleLowerCase("zh-CN").includes(trimmed.toLocaleLowerCase("zh-CN")) || originalText.includes(canonical)
    ? canonical
    : null;
}

function stricterPositiveLimit(local?: number, model?: number | null) {
  const values = [local, model ?? undefined].filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
  return values.length ? Math.min(...values) : undefined;
}

/**
 * The model may add language understanding, but it may never replace locally
 * detected safety constraints. Model terms are accepted only when grounded in
 * the original user text (including a small, explicit bilingual allergen map).
 */
export function mergeMealRequests(local: ParsedMealRequest, model: ModelMealRequest, originalText: string): ParsedMealRequest {
  const groundedPreferred = model.preferredTerms.flatMap((term) => termFromUserText(originalText, term) ?? []);
  const groundedAvoided = model.avoidedTerms.flatMap((term) => termFromUserText(originalText, term) ?? []);
  const groundedStrict = model.strictAvoidedTerms.flatMap((term) => termFromUserText(originalText, term) ?? []);
  const strictAvoidedTerms = unique([...local.strictAvoidedTerms, ...groundedStrict]);
  const avoidedTerms = unique([...local.avoidedTerms, ...groundedAvoided]).filter((term) => !strictAvoidedTerms.includes(term));
  const preferredTerms = unique([...local.preferredTerms, ...groundedPreferred])
    .filter((term) => !avoidedTerms.includes(term) && !strictAvoidedTerms.includes(term));
  const hardPriceLimitCents = stricterPositiveLimit(local.hardPriceLimitCents, model.hardPriceLimitCents);
  const targetPriceCents = local.targetPriceCents ?? (model.targetPriceCents && model.targetPriceCents > 0 ? model.targetPriceCents : undefined);
  const rejectsSpicy = [...avoidedTerms, ...strictAvoidedTerms].some((term) => term.includes("辣"));
  const quickTags = unique([...local.quickTags, ...model.quickTags])
    .filter((tag) => !(tag === "SPICY" && rejectsSpicy)) as MealRecommendationQuickTag[];

  return {
    quickTags,
    historyQuery: local.historyQuery,
    ...(hardPriceLimitCents ? { hardPriceLimitCents } : {}),
    ...(targetPriceCents ? { targetPriceCents } : {}),
    preferredTerms,
    avoidedTerms,
    strictAvoidedTerms,
  };
}

export function parseMealRequest(value: string): ParsedMealRequest {
  const text = value.trim();
  const historyQuery = /(?=.*(?:最近|近期|这阵子|前段时间|之前|过去))(?=.*(?:吃过|吃了|点过|点了|买过))(?=.*(?:不常吃|不常点|不经常吃|不经常点|很少吃|很少点|吃得少|点得少|次数少|偶尔吃|偶尔点))/.test(text)
    ? "RECENT_INFREQUENT" as const
    : null;
  const quickTags: MealRecommendationQuickTag[] = [];
  if (/省|便宜|实惠|性价比/.test(text)) quickTags.push("SAVE_MONEY");
  if (/换.{0,2}(口味|一批)|不一样|新鲜/.test(text)) quickTags.push("TRY_DIFFERENT");
  if (/清淡|少油|低脂|健康/.test(text)) quickTags.push("LIGHT");
  const rejectsSpicy = /(?:不太想吃|不太想要|不怎么想吃|不想吃|不要|不吃|不能吃|忌口|避开).{0,3}辣/.test(text);
  if (!rejectsSpicy && /(?:^|[，。,.！!？?\s])(?:想吃|要|喜欢).{0,3}辣/.test(text)) quickTags.push("SPICY");
  if (/近一点|不想走远|附近|就近|外卖|配送/.test(text)) quickTags.push("STAY_NEAR");

  const hardPrice = text.match(/(?:不超过|最多|控制在|预算(?:是|为)?|人均不超过)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)?|[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)\s*(?:以内|以下|封顶)/);
  const targetPrice = text.match(/[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)\s*(?:左右|上下|附近)/);
  const yuan = hardPrice ? Number(hardPrice[1] ?? hardPrice[2]) : Number.NaN;
  const targetYuan = targetPrice ? Number(targetPrice[1]) : Number.NaN;
  const hardPriceLimitCents = Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : undefined;
  const targetPriceCents = Number.isFinite(targetYuan) && targetYuan > 0 ? Math.round(targetYuan * 100) : undefined;
  const avoidedTerms = unique(capturedTerms(text, [avoidancePattern])
    .map((term) => term.replace(/(?:的|食物|食品)$/, "").trim()));
  const strictAvoidedTerms = unique(capturedTerms(text, strictAvoidancePatterns)
    .map((term) => term.replace(/(?:的|食物|食品)$/, "").trim()));
  const preferredTerms = unique(capturedTerms(text, preferencePatterns)
    .map((term) => term.replace(/(?:的|一点|一些|吧)$/, "").trim()))
    .filter((term) => !avoidedTerms.includes(term) && !strictAvoidedTerms.includes(term));

  return {
    quickTags: [...new Set(quickTags)], historyQuery,
    ...(hardPriceLimitCents ? { hardPriceLimitCents } : {}),
    ...(targetPriceCents ? { targetPriceCents } : {}),
    preferredTerms, avoidedTerms, strictAvoidedTerms,
  };
}
