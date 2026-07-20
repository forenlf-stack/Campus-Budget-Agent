import { z } from "zod";

import { readModelConfig } from "@/server/model-config-store";

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable(), reasoning_content: z.string().optional() }) })).min(1),
});

function endpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export interface DeepSeekCallOptions {
  timeoutMs?: number;
  thinking?: "enabled" | "disabled";
  fetchImplementation?: typeof fetch;
}

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callDeepSeekMessagesJson<T>(messages: DeepSeekMessage[], schema: z.ZodType<T>, options: DeepSeekCallOptions = {}): Promise<T> {
  const config = readModelConfig();
  if (!config.deepseekApiKey) throw new Error("DeepSeek 尚未配置");
  const timeoutMs = options.timeoutMs ?? 12_000;
  const thinking = options.thinking ?? "disabled";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImplementation ?? fetch)(endpoint(config.deepseekBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekModel,
        messages,
        thinking: { type: thinking },
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DeepSeek 返回 ${response.status}`);
    const message = completionSchema.parse(await response.json()).choices[0].message;
    const content = message.content ?? message.reasoning_content;
    if (!content) throw new Error("DeepSeek 未返回可解析内容");
    const normalized = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    return schema.parse(JSON.parse(normalized));
  } finally {
    clearTimeout(timeout);
  }
}

export async function callDeepSeekJson<T>(system: string, user: string, schema: z.ZodType<T>, options: DeepSeekCallOptions = {}): Promise<T> {
  return callDeepSeekMessagesJson([{ role: "system", content: system }, { role: "user", content: user }], schema, options);
}

export async function testDeepSeekConnection() {
  const schema = z.object({ ok: z.literal(true), message: z.string().max(100) });
  return callDeepSeekJson("只返回JSON。", "返回 {\"ok\":true,\"message\":\"连接成功\"}", schema, { timeoutMs: 10_000, thinking: "disabled" });
}
