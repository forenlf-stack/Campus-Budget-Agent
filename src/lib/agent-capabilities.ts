/**
 * Capacity limits protect the API from unbounded payloads without turning
 * product preferences into hard Agent constraints. Business guardrails live
 * in the workflow/ranking layer and are deliberately classified separately.
 */
export const agentCapabilities = {
  mealRecommendations: {
    defaultCount: 6,
    maximumCount: 10,
    recentMealCount: 10,
  },
  conversation: {
    maximumHistoryMessages: 20,
    maximumMessageCharacters: 2_000,
    maximumReplyCharacters: 1_600,
  },
  languageUnderstanding: {
    maximumRequestCharacters: 2_000,
    maximumPreferenceTerms: 30,
    maximumTermCharacters: 60,
  },
  model: {
    defaultTimeoutMs: 30_000,
  },
} as const;
