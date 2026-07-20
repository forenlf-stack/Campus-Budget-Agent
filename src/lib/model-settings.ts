import { z } from "zod";

const url = z.string().trim().url().max(500);

export const modelSettingsUpdateSchema = z.object({
  deepseekBaseUrl: url,
  deepseekModel: z.string().trim().min(1).max(100),
  deepseekApiKey: z.string().trim().max(500).optional(),
  clearDeepseekApiKey: z.boolean().default(false),
  glmBaseUrl: url,
  glmOcrModel: z.string().trim().min(1).max(100),
  glmApiKey: z.string().trim().max(500).optional(),
  clearGlmApiKey: z.boolean().default(false),
  visionBaseUrl: url,
  visionModel: z.string().trim().min(1).max(100),
  visionApiKey: z.string().trim().max(500).optional(),
  clearVisionApiKey: z.boolean().default(false),
}).strict();

export const modelSettingsPublicSchema = z.object({
  deepseekBaseUrl: url,
  deepseekModel: z.string(),
  deepseekConfigured: z.boolean(),
  glmBaseUrl: url,
  glmOcrModel: z.string(),
  glmConfigured: z.boolean(),
  visionBaseUrl: url,
  visionModel: z.string(),
  visionConfigured: z.boolean(),
});

export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>;
export type ModelSettingsPublic = z.infer<typeof modelSettingsPublicSchema>;
