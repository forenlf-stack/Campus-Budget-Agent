import { agentCapabilities } from "@/lib/agent-capabilities";
import type { MealAgentMessage } from "@/lib/meal-agent-chat";

export type MealInputRoute = "DIRECT_RECOMMENDATION" | "ASSESSMENT" | "CHAT";

const chineseDigitValues: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};

function parseChineseInteger(value: string): number | null {
  if (!value || !/^[零〇一二两三四五六七八九十百千]+$/.test(value)) return null;
  if (!/[十百千]/.test(value)) {
    const digits = [...value].map((character) => chineseDigitValues[character]);
    return digits.every((digit) => digit !== undefined) ? Number(digits.join("")) : null;
  }
  let total = 0;
  let current = 0;
  for (const character of value) {
    const digit = chineseDigitValues[character];
    if (digit !== undefined) {
      current = digit;
      continue;
    }
    const unit = character === "十" ? 10 : character === "百" ? 100 : 1_000;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function fractionalCents(value: string | undefined, unit: "元" | "块") {
  if (!value) return 0;
  const normalized = [...value].map((character) => chineseDigitValues[character] ?? character).join("");
  if (!/^\d{1,2}$/.test(normalized)) return 0;
  if (unit === "块" && normalized.length === 1) return Number(normalized) * 10;
  return Number(normalized.padEnd(2, "0"));
}

/** Extracts the first explicitly stated meal price, including ￥30 and 31块5. */
export function parseMentionedPriceCents(input: string): number | null {
  const symbol = input.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
  if (symbol) return Math.round(Number(symbol[1]) * 100);

  const arabic = input.match(/(\d+(?:\.\d{1,2})?)\s*(元|块)(?:\s*(\d{1,2})(?!\s*[角分]))?/);
  if (arabic) {
    const yuan = Number(arabic[1]);
    const cents = arabic[1].includes(".") ? 0 : fractionalCents(arabic[3], arabic[2] as "元" | "块");
    return Math.round(yuan * 100) + cents;
  }

  const jiaoFen = input.match(/([零〇一二两三四五六七八九十百千]+)\s*元(?:\s*零)?(?:\s*([一二两三四五六七八九])\s*角)?(?:\s*([一二两三四五六七八九])\s*分)?/);
  if (jiaoFen && (jiaoFen[2] || jiaoFen[3])) {
    const yuan = parseChineseInteger(jiaoFen[1]);
    if (yuan === null) return null;
    return yuan * 100 + (chineseDigitValues[jiaoFen[2]] ?? 0) * 10 + (chineseDigitValues[jiaoFen[3]] ?? 0);
  }

  const chinese = input.match(/([零〇一二两三四五六七八九十百千]+)\s*(元|块)(?:\s*([零〇一二两三四五六七八九]{1,2})(?!\s*[角分]))?/);
  if (chinese) {
    const yuan = parseChineseInteger(chinese[1]);
    if (yuan === null) return null;
    return yuan * 100 + fractionalCents(chinese[3], chinese[2] as "元" | "块");
  }

  return null;
}

const recommendationIntentPattern = /(?:吃什么|帮我(?:推荐|选)|给我推荐|推荐(?:一(?:个|份|顿)|点|些|一下|\d|[零〇一二两三四五六七八九十百千]|\s*$)|建议吃|来一(?:份|顿)|换一批|重新推荐|按.+筛选)/;
const recommendationConstraintPattern = /(?:以内|以下|不超过|预算|清淡|少油|低脂|健康|不辣|不要辣|不想吃|不能吃|忌口|过敏|附近|不想走远|便宜|实惠|性价比|想吃辣)/;
const assessmentIntentPattern = /(?:怎么样|合适吗|值不值|划算吗|能不能吃|可以吃吗|建议吗|评价|你认为|值得吗|贵不贵|超预算吗)/;
const concreteFoodPattern = /(?:咖喱|麻辣烫|火锅|烧烤|汉堡|披萨|寿司|沙拉|米线|馄饨|豆腐|鳗|鸡|鸭|鱼|虾|牛|猪|肉|蛋|饭|面|粉|粥|饺|包|饼|锅|汤|菜)/;

export function classifyMealInput(input: string): MealInputRoute {
  const message = input.trim();
  // A request to generate choices wins even when it also contains a price.
  if (recommendationIntentPattern.test(message)) return "DIRECT_RECOMMENDATION";
  // “想吃 + 明确筛选条件”本身就是推荐请求，不应退化为普通聊天。
  if (/(?:想吃|想要|来点)/.test(message) && recommendationConstraintPattern.test(message)) return "DIRECT_RECOMMENDATION";
  if (parseMentionedPriceCents(message) === null || !assessmentIntentPattern.test(message)) return "CHAT";
  const withoutGenericMeal = message.replace(/这\s*(?:一)?\s*(?:顿|份|个)?\s*(?:饭|餐|东西)/g, "");
  return concreteFoodPattern.test(withoutGenericMeal) ? "ASSESSMENT" : "CHAT";
}

export function truncateMealMessage(content: string) {
  return content.slice(0, agentCapabilities.conversation.maximumMessageCharacters);
}

export function normalizeMealConversation(messages: MealAgentMessage[]): MealAgentMessage[] {
  return messages
    .map((message) => ({ ...message, content: truncateMealMessage(message.content.trim()) }))
    .filter((message) => message.content.length > 0)
    .slice(-agentCapabilities.conversation.maximumHistoryMessages);
}
