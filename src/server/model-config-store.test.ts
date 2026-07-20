import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { publicModelConfig, readModelConfig, saveModelConfig } from "./model-config-store";

const file = path.join(process.cwd(), ".model-config-test.json");

afterEach(() => { try { fs.unlinkSync(file); } catch { /* File may not exist. */ } });

describe("model_config_store", () => {
  it("公开配置不返回API Key", () => {
    const publicConfig = publicModelConfig({ ...readModelConfig(), deepseekApiKey: "secret", glmApiKey: "ocr-secret", visionApiKey: "vision-secret" });
    expect(publicConfig).toMatchObject({ deepseekConfigured: true, glmConfigured: true, visionConfigured: true });
    expect(publicConfig).not.toHaveProperty("deepseekApiKey");
    expect(publicConfig).not.toHaveProperty("glmApiKey");
    expect(publicConfig).not.toHaveProperty("visionApiKey");
  });

  it("留空API Key时保留已有密钥", () => {
    saveModelConfig({ deepseekBaseUrl: "https://api.deepseek.com", deepseekModel: "deepseek-v4-pro", deepseekApiKey: "secret", clearDeepseekApiKey: false, glmBaseUrl: "https://open.bigmodel.cn/api", glmOcrModel: "hand_write", glmApiKey: "ocr-secret", clearGlmApiKey: false, visionBaseUrl: "https://apinebula.com/v1", visionModel: "gpt-5.4-mini", visionApiKey: "vision-secret", clearVisionApiKey: false }, file);
    saveModelConfig({ deepseekBaseUrl: "https://api.deepseek.com", deepseekModel: "deepseek-v4-flash", clearDeepseekApiKey: false, glmBaseUrl: "https://open.bigmodel.cn/api", glmOcrModel: "hand_write", clearGlmApiKey: false, visionBaseUrl: "https://apinebula.com/v1", visionModel: "gpt-5.4-mini", clearVisionApiKey: false }, file);
    expect(readModelConfig(file)).toMatchObject({ deepseekApiKey: "secret", deepseekModel: "deepseek-v4-flash", glmApiKey: "ocr-secret", visionApiKey: "vision-secret" });
  });
});
