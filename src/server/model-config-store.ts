import fs from "node:fs";
import path from "node:path";

import type { ModelSettingsPublic, ModelSettingsUpdate } from "@/lib/model-settings";

export interface StoredModelConfig {
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKey: string;
  glmBaseUrl: string;
  glmOcrModel: string;
  glmApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
  visionApiKey: string;
}

const defaultConfigPath = path.join(/* turbopackIgnore: true */ process.cwd(), ".local-model-config.json");
const defaults: StoredModelConfig = {
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekModel: "deepseek-v4-pro",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  glmBaseUrl: "https://open.bigmodel.cn/api",
  glmOcrModel: "hand_write",
  glmApiKey: process.env.GLM_API_KEY ?? "",
  visionBaseUrl: "https://apinebula.com/v1",
  visionModel: "gpt-5.4-mini",
  visionApiKey: process.env.VISION_API_KEY ?? "",
};

export function readModelConfig(filePath = defaultConfigPath): StoredModelConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<StoredModelConfig>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function publicModelConfig(config = readModelConfig()): ModelSettingsPublic {
  return {
    deepseekBaseUrl: config.deepseekBaseUrl,
    deepseekModel: config.deepseekModel,
    deepseekConfigured: Boolean(config.deepseekApiKey),
    glmBaseUrl: config.glmBaseUrl,
    glmOcrModel: config.glmOcrModel,
    glmConfigured: Boolean(config.glmApiKey),
    visionBaseUrl: config.visionBaseUrl,
    visionModel: config.visionModel,
    visionConfigured: Boolean(config.visionApiKey),
  };
}

export function saveModelConfig(input: ModelSettingsUpdate, filePath = defaultConfigPath): ModelSettingsPublic {
  const current = readModelConfig(filePath);
  const next: StoredModelConfig = {
    deepseekBaseUrl: input.deepseekBaseUrl,
    deepseekModel: input.deepseekModel,
    deepseekApiKey: input.clearDeepseekApiKey ? "" : input.deepseekApiKey || current.deepseekApiKey,
    glmBaseUrl: input.glmBaseUrl,
    glmOcrModel: input.glmOcrModel,
    glmApiKey: input.clearGlmApiKey ? "" : input.glmApiKey || current.glmApiKey,
    visionBaseUrl: input.visionBaseUrl,
    visionModel: input.visionModel,
    visionApiKey: input.clearVisionApiKey ? "" : input.visionApiKey || current.visionApiKey,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return publicModelConfig(next);
}
