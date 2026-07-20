import { z } from "zod";

import {
  menuCandidateRiskValues,
  menuCandidateSchema,
  menuMealRecommendationsSchema,
  type MenuCandidate,
  type MenuCandidateRisk,
  type MenuMealRecommendations,
} from "@/lib/menu-meal-recommendations";
import { skillFailure, skillSuccess, type SkillResult } from "@/lib/skill-result";
import {
  MenuRecognitionProviderError,
  menuRecognitionProvider,
  type MenuRecognitionProvider,
} from "@/server/menu-recognition/menu-recognition-provider";
import { parseOcrMenuText } from "@/server/menu-recognition/menu-recognition-provider";
import { organizeOcrMenuTextWithLlm } from "@/server/llm/agent-reasoning";

const extractMenuCandidatesInputSchema = z.object({
  image: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict();

const providerCandidateSchema = z.object({
  name: z.string().trim().min(1),
  priceCents: z.number().int().safe().positive().nullable().optional(),
  priceText: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  visibleTags: z.array(z.string().trim().min(1)).optional(),
  confidence: z.number().min(0).max(1),
  rawTextReference: z.string().trim().min(1),
  needsConfirmation: z.boolean().optional(),
  risks: z.array(z.enum(menuCandidateRiskValues)).optional(),
}).strict();

const providerOutputSchema = z.object({ candidates: z.array(z.unknown()) }).strict();
const ambiguousPricePattern = /(?:会员价|会员专享|起售价?|起步价|价格?起|任选|选规格|选套餐|多规格|不同规格|模糊|不清|看不清|[~～])/i;
const blurryPattern = /(?:模糊|不清|看不清)/i;
const memberPattern = /(?:会员价|会员专享)/i;
const setPattern = /(?:任选|选规格|选套餐|多规格|不同规格)/i;

function parseProviderOutput(output: unknown): z.infer<typeof providerOutputSchema> {
  const value = typeof output === "string" ? JSON.parse(output) as unknown : output;
  return providerOutputSchema.parse(value);
}

async function organizeProviderOutput(output: unknown) {
  if (output && typeof output === "object" && "ocrText" in output && typeof output.ocrText === "string") {
    try { return await organizeOcrMenuTextWithLlm(output.ocrText); }
    catch { return { candidates: parseOcrMenuText(output.ocrText) }; }
  }
  return output;
}

function addRisk(risks: Set<MenuCandidateRisk>, risk: MenuCandidateRisk, condition: boolean) {
  if (condition) risks.add(risk);
}

function explicitCurrentPrice(candidate: z.infer<typeof providerCandidateSchema>): { cents: number; text: string } | null {
  const sources = [candidate.priceText, candidate.rawTextReference].filter((text): text is string => Boolean(text));
  for (const source of sources) {
    const labeled = source.match(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)\s*(?:神券价|券后价|补贴价|特价|现价)/i);
    const matches = [...source.matchAll(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/g)];
    const match = labeled ?? (matches.length === 1 ? matches[0] : null);
    if (!match) continue;
    const yuan = Number(match[1]);
    const cents = Math.round(yuan * 100);
    if (Number.isFinite(yuan) && cents >= 300 && Number.isSafeInteger(cents)) return { cents, text: match[0] };
  }
  return null;
}

function toMenuCandidate(value: unknown, index: number): MenuCandidate | null {
  const parsed = providerCandidateSchema.safeParse(value);
  if (!parsed.success) return null;

  const candidate = parsed.data;
  const normalizedName = candidate.name.replace(/\s+/g, "").trim();
  const uiNoisePattern = /^(?:[()<>]|.{0,2}KB'?s?|减|台|点|贴|省|系列|套餐|招牌|推荐|门店福利|甄选推荐|拌面|汤面|免辣|不辣|外送|外卖|自取|预订|拼单|选规格|选套餐|特价爆品|零售产品|甜品饮料)$/i;
  const foodSignalPattern = /(?:饭|面|粉|米线|饺|鸡|鸭|牛|猪|肉|鱼|虾|菜|汤|粥|包|饼|锅|冒菜|小吃|饮品|饮料|套餐|汉堡|披萨|寿司|沙拉)/;
  if (normalizedName.length < 3 || uiNoisePattern.test(normalizedName)) return null;
  if (!foodSignalPattern.test(normalizedName) && !(candidate.description && foodSignalPattern.test(candidate.description))) return null;
  const priceEvidence = [candidate.priceText, candidate.rawTextReference].filter((text): text is string => Boolean(text)).join(" ");
  const ambiguousPrice = ambiguousPricePattern.test(priceEvidence);
  const recoveredPrice = !ambiguousPrice ? explicitCurrentPrice(candidate) : null;
  const priceCents = candidate.priceCents && candidate.priceCents >= 300 ? candidate.priceCents : recoveredPrice?.cents ?? null;
  // Recompute price risks locally so an overly cautious model cannot turn every clearly priced set meal into an unknown price.
  const risks = new Set<MenuCandidateRisk>((candidate.risks ?? []).filter((risk) => !["PRICE_UNCERTAIN", "MEMBER_PRICE", "SET_PRICE"].includes(risk)));
  addRisk(risks, "LOW_CONFIDENCE", candidate.confidence < 0.7);
  addRisk(risks, "IMAGE_BLURRY", blurryPattern.test(priceEvidence));
  addRisk(risks, "MEMBER_PRICE", memberPattern.test(priceEvidence));
  addRisk(risks, "SET_PRICE", setPattern.test(priceEvidence));
  addRisk(risks, "PRICE_UNCERTAIN", priceCents === null || ambiguousPrice);

  const result: MenuCandidate = {
    temporaryId: `vision-${index + 1}`,
    name: candidate.name,
    priceCents: ambiguousPrice ? null : priceCents,
    priceText: candidate.priceText ?? recoveredPrice?.text ?? null,
    description: candidate.description ?? null,
    visibleTags: candidate.visibleTags ?? [],
    confidence: candidate.confidence,
    source: "VISION",
    rawTextReference: candidate.rawTextReference,
    needsConfirmation: candidate.confidence < 0.7 || risks.has("PRICE_UNCERTAIN") || risks.has("MEMBER_PRICE") || risks.has("SET_PRICE") || risks.has("IMAGE_BLURRY"),
    risks: [...risks],
  };
  return menuCandidateSchema.parse(result);
}

export async function extractMenuCandidates(
  input: unknown,
  provider: MenuRecognitionProvider = menuRecognitionProvider,
): Promise<SkillResult<MenuMealRecommendations>> {
  try {
    const parsedInput = extractMenuCandidatesInputSchema.parse(input);
    const providerOutput = parseProviderOutput(await organizeProviderOutput(await provider.recognize(parsedInput)));
    const candidates = providerOutput.candidates
      .map(toMenuCandidate)
      .filter((candidate): candidate is MenuCandidate => candidate !== null);
    return skillSuccess(menuMealRecommendationsSchema.parse({
      candidates,
      rejectedCandidateCount: providerOutput.candidates.length - candidates.length,
    }));
  } catch (error) {
    const invalidOutput = error instanceof SyntaxError || error instanceof z.ZodError;
    if (error instanceof MenuRecognitionProviderError) {
      return skillFailure(error.code, error.message);
    }
    const timedOut = error instanceof Error && error.name === "AbortError";
    return skillFailure(
      timedOut ? "MENU_RECOGNITION_TIMEOUT" : invalidOutput ? "INVALID_MENU_RECOGNITION_OUTPUT" : "MENU_RECOGNITION_ERROR",
      timedOut ? "菜单识别服务超时，请重试" : error instanceof Error ? error.message : "菜单识别失败",
    );
  }
}
