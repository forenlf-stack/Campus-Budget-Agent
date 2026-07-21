import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealPeriods } from "@/lib/meal-candidates";
import {
  mealRecommendationCardSchema,
  mealRecommendationQuickTags,
} from "@/lib/meal-recommendations";

export const menuCandidateRiskValues = [
  "LOW_CONFIDENCE",
  "IMAGE_BLURRY",
  "PRICE_UNCERTAIN",
  "MEMBER_PRICE",
  "SET_PRICE",
] as const;

export const menuRecommendationStatuses = [
  "READY",
  "NEEDS_PRICE_CONFIRMATION",
  "NO_RECOMMENDATIONS",
  "NO_MENU_CONTENT",
  "INSUFFICIENT_MENU_CONTENT",
] as const;

export const menuImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;

const nonEmptyText = z.string().trim().min(1);
const positiveCents = z.number().int().safe().positive();

export const menuCandidateSchema = z.object({
  temporaryId: nonEmptyText,
  name: nonEmptyText,
  priceCents: positiveCents.nullable(),
  priceText: nonEmptyText.nullable(),
  description: nonEmptyText.nullable(),
  visibleTags: z.array(nonEmptyText),
  confidence: z.number().min(0).max(1),
  source: z.enum(["VISION", "MENU_TEXT"]),
  rawTextReference: nonEmptyText,
  needsConfirmation: z.boolean(),
  risks: z.array(z.enum(menuCandidateRiskValues)),
}).strict();

export const extractedMenuCandidatesSchema = z.object({
  candidates: z.array(menuCandidateSchema),
  rejectedCandidateCount: z.number().int().nonnegative(),
}).strict();

export const confirmedMenuPriceSchema = z.object({
  temporaryId: nonEmptyText.max(100),
  priceCents: positiveCents,
}).strict();

export const menuRecommendationSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    image: nonEmptyText,
    mimeType: z.enum(menuImageMimeTypes),
  }).strict(),
  z.object({
    type: z.literal("menuText"),
    menuText: nonEmptyText.max(20_000),
  }).strict(),
]);

export const menuMealRecommendationInputSchema = z.object({
  source: menuRecommendationSourceSchema,
  quickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length).default([]),
  userRequest: z.string().trim().max(agentCapabilities.languageUnderstanding.maximumRequestCharacters).default(""),
  maxRecommendations: z.number().int().min(1).max(agentCapabilities.mealRecommendations.maximumCount)
    .default(agentCapabilities.mealRecommendations.defaultCount),
  skipAgentInterpretation: z.boolean().default(false),
  confirmedPrices: z.array(confirmedMenuPriceSchema).max(300).default([]),
  date: z.date().refine((value) => Number.isFinite(value.getTime()), "查询日期无效").optional(),
}).strict();

export const menuRecommendationTimingSchema = z.object({
  extractionMs: z.number().nonnegative(),
  contextMs: z.number().nonnegative(),
  rankingMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
}).strict();

export const menuRecognitionSummarySchema = z.object({
  source: z.enum(["image", "menuText"]),
  detectedCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  warnings: z.array(nonEmptyText),
}).strict();

export const menuMealRecommendationResponseSchema = z.object({
  runId: nonEmptyText,
  status: z.enum(menuRecommendationStatuses),
  source: z.enum(["image", "menuText"]),
  mealPeriod: z.enum(mealPeriods),
  location: nonEmptyText.optional(),
  recognition: menuRecognitionSummarySchema,
  pendingConfirmation: z.array(menuCandidateSchema),
  recommendations: z.array(mealRecommendationCardSchema).max(agentCapabilities.mealRecommendations.maximumCount),
  timing: menuRecommendationTimingSchema,
  rejectedCandidateCount: z.number().int().nonnegative(),
}).strict();

// Kept as an alias for the extraction skill's existing public contract.
export const menuMealRecommendationsSchema = extractedMenuCandidatesSchema;

export type MenuCandidateRisk = (typeof menuCandidateRiskValues)[number];
export type MenuRecommendationStatus = (typeof menuRecommendationStatuses)[number];
export type MenuCandidate = z.infer<typeof menuCandidateSchema>;
export type MenuMealRecommendations = z.infer<typeof extractedMenuCandidatesSchema>;
export type ConfirmedMenuPrice = z.infer<typeof confirmedMenuPriceSchema>;
export type MenuMealRecommendationInput = z.infer<typeof menuMealRecommendationInputSchema>;
export type MenuMealRecommendationResponse = z.infer<typeof menuMealRecommendationResponseSchema>;
