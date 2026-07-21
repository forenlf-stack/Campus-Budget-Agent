import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { mealRecommendationCardSchema, mealRecommendationQuickTags } from "@/lib/meal-recommendations";

export const mealAgentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters),
}).strict();

export const mealAgentChatInputSchema = z.object({
  message: z.string().trim().min(1).max(agentCapabilities.conversation.maximumMessageCharacters),
  history: z.array(mealAgentMessageSchema).max(agentCapabilities.conversation.maximumHistoryMessages).default([]),
  recommendations: z.array(mealRecommendationCardSchema).max(agentCapabilities.mealRecommendations.maximumCount),
}).strict();

export const mealAgentChatResponseSchema = z.object({
  reply: z.string().trim().min(1).max(agentCapabilities.conversation.maximumReplyCharacters),
  referencedCandidateIds: z.array(z.string().trim().min(1)).max(agentCapabilities.mealRecommendations.maximumCount),
  suggestedRequest: z.string().trim().max(agentCapabilities.languageUnderstanding.maximumRequestCharacters).nullable(),
  suggestedQuickTags: z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length),
  needsNewRecommendation: z.boolean(),
  source: z.enum(["LLM", "RULES"]),
  fallbackReason: z.string().optional(),
}).strict();

export type MealAgentMessage = z.infer<typeof mealAgentMessageSchema>;
export type MealAgentChatResponse = z.infer<typeof mealAgentChatResponseSchema>;
