import { menuCandidateSchema, type MenuCandidate } from "@/lib/menu-meal-recommendations";

const ambiguousPricePattern = /(?:会员价|会员专享|起售价?|起步价|价格?起|任选|选规格|选套餐|多规格|不同规格|[~～])/i;
const markedPricePattern = /(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块))/g;
const bareTrailingPricePattern = /(?:^|[\s:：])((?:\d{1,3})(?:\.\d{1,2})?)\s*$/;

export function parseMenuText(menuText: string): MenuCandidate[] {
  return menuText.split(/\r?\n/).flatMap((rawLine, index): MenuCandidate[] => {
    const line = rawLine.trim();
    if (!line) return [];
    const markedMatches = [...line.matchAll(markedPricePattern)];
    const bareMatch = markedMatches.length === 0 ? line.match(bareTrailingPricePattern) : null;
    const match = markedMatches.length === 1 ? markedMatches[0] : bareMatch;
    const ambiguous = ambiguousPricePattern.test(line) || markedMatches.length > 1;
    if (!match && markedMatches.length === 0 && !ambiguousPricePattern.test(line)) return [];
    const amountText = match?.[1] ?? match?.[2];
    const priceStart = match?.index ?? line.length;
    const priceEnd = match ? priceStart + match[0].length : line.length;
    const name = markedMatches.length > 1
      ? line.replace(markedPricePattern, " ").replace(/[\s:：.。·\-—/]+/g, " ").trim()
      : match
      ? `${line.slice(0, priceStart)} ${line.slice(priceEnd)}`.replace(/[\s:：.。·\-—]+/g, " ").trim()
      : line.replace(/[\s:：.。·\-—]+$/, "").trim();
    if (!name) return [];
    const yuan = amountText ? Number(amountText) : Number.NaN;
    const priceCents = !ambiguous && Number.isFinite(yuan) && yuan > 0 && yuan <= 10_000
      ? Math.round(yuan * 100)
      : null;
    return [menuCandidateSchema.parse({
      temporaryId: `text-${index + 1}`,
      name,
      priceCents,
      priceText: match?.[0].trim() ?? null,
      description: null,
      visibleTags: [],
      confidence: priceCents === null ? 0.5 : 1,
      source: "MENU_TEXT",
      rawTextReference: line,
      needsConfirmation: priceCents === null,
      risks: priceCents === null ? ["PRICE_UNCERTAIN"] : [],
    })];
  });
}
