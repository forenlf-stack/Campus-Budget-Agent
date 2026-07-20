import { z } from "zod";

import { mealRecommendationCardSchema, mealRecommendationQuickTags } from "@/lib/meal-recommendations";

export const mealAgentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(800),
}).strict();

export const mealAgentChatInputSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(mealAgentMessageSchema).max(8).default([]),
  recommendations: z.array(mealRecommendationCardSchema).max(4),
}).strict();

export const mealAgentChatResponseSchema = z.object({
  reply: z.string().trim().min(1).max(800),
  referencedCandidateIds: z.array(z.string().trim().min(1)).max(4),
  suggestedRequest: z.string().trim().max(300).nullable(),
  suggestedQuickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length),
  needsNewRecommendation: z.boolean(),
  source: z.enum(["LLM", "RULES"]),
  fallbackReason: z.string().optional(),
}).strict();

export type MealAgentMessage = z.infer<typeof mealAgentMessageSchema>;
export type MealAgentChatResponse = z.infer<typeof mealAgentChatResponseSchema>;
