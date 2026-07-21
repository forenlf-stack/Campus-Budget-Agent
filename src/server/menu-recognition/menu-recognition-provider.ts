export interface MenuRecognitionInput {
  image?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  menuText?: string;
}

export interface MenuRecognitionProvider {
  recognize(input: MenuRecognitionInput): Promise<unknown>;
}

export interface RawMenuOcrOutput { ocrText: string }

interface OpenAiChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}

export interface FetchMenuRecognitionProviderOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

export type MenuRecognitionProviderErrorCode =
  | "MENU_RECOGNITION_NOT_CONFIGURED"
  | "MENU_RECOGNITION_TIMEOUT"
  | "MENU_RECOGNITION_UPSTREAM_ERROR";

export class MenuRecognitionProviderError extends Error {
  constructor(readonly code: MenuRecognitionProviderErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = "MenuRecognitionProviderError";
  }
}

function configuredTimeout(value: string | undefined): number {
  const timeout = Number(value ?? 30_000);
  return Number.isSafeInteger(timeout) && timeout > 0 ? Math.min(timeout, 60_000) : 30_000;
}

export class FetchMenuRecognitionProvider implements MenuRecognitionProvider {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: FetchMenuRecognitionProviderOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.MENU_RECOGNITION_API_URL ?? "";
    this.apiKey = options.apiKey ?? process.env.MENU_RECOGNITION_API_KEY;
    this.model = options.model ?? process.env.MENU_RECOGNITION_MODEL ?? "menu-recognition";
    this.timeoutMs = options.timeoutMs === undefined
      ? configuredTimeout(process.env.MENU_RECOGNITION_TIMEOUT_MS)
      : Math.min(Math.max(options.timeoutMs, 1), 60_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async recognize(input: MenuRecognitionInput): Promise<unknown> {
    if (!this.endpoint) throw new MenuRecognitionProviderError("MENU_RECOGNITION_NOT_CONFIGURED", "未配置菜单图片识别服务");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST", headers, body: JSON.stringify({ model: this.model, ...input }), signal: controller.signal,
      });
      if (!response.ok) {
        throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", `菜单识别服务返回 ${response.status}`, response.status);
      }
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof MenuRecognitionProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new MenuRecognitionProviderError("MENU_RECOGNITION_TIMEOUT", "菜单识别服务超时，请重试");
      }
      throw new MenuRecognitionProviderError(
        "MENU_RECOGNITION_UPSTREAM_ERROR",
        error instanceof Error ? error.message : "菜单识别服务不可用",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const glmOcrResponseSchema = {
  parse(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("GLM OCR 返回格式无效");
    const object = value as { status?: unknown; words_result?: unknown };
    if (object.status !== "succeeded" || !Array.isArray(object.words_result)) throw new Error("GLM OCR 识别失败");
    return object.words_result.flatMap((item) => {
      if (!item || typeof item !== "object" || !("words" in item)) return [];
      const row = item as { words: unknown; location?: { left?: unknown; top?: unknown; width?: unknown; height?: unknown } };
      const words = String(row.words).trim();
      if (!words) return [];
      const left = Number(row.location?.left ?? 0);
      const top = Number(row.location?.top ?? 0);
      const width = Number(row.location?.width ?? 0);
      const height = Number(row.location?.height ?? 0);
      return [{ words, left, top, width, height }];
    }).sort((left, right) => left.top - right.top || left.left - right.left)
      .map((item) => `[x=${item.left},y=${item.top},w=${item.width},h=${item.height}] ${item.words}`)
      .join("\n");
  },
};

export class GlmOcrMenuRecognitionProvider implements MenuRecognitionProvider {
  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async recognize(input: MenuRecognitionInput): Promise<unknown> {
    if (!input.image || !input.mimeType) throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", "GLM OCR 缺少图片输入");
    const config = readModelConfig();
    if (!config.glmApiKey) throw new MenuRecognitionProviderError("MENU_RECOGNITION_NOT_CONFIGURED", "未配置 GLM OCR API Key");
    const bytes = Buffer.from(input.image, "base64");
    const form = new FormData();
    form.append("file", new File([bytes], `menu.${input.mimeType.split("/")[1]}`, { type: input.mimeType }));
    form.append("tool_type", config.glmOcrModel || "hand_write");
    form.append("language_type", "CHN_ENG");
    form.append("probability", "true");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImplementation(`${config.glmBaseUrl.replace(/\/$/, "")}/paas/v4/files/ocr`, { method: "POST", headers: { Authorization: `Bearer ${config.glmApiKey}` }, body: form, signal: controller.signal });
      if (!response.ok) throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", `GLM OCR 返回 ${response.status}`, response.status);
      const menuText = glmOcrResponseSchema.parse(await response.json());
      return { ocrText: menuText } satisfies RawMenuOcrOutput;
    } catch (error) {
      if (error instanceof MenuRecognitionProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new MenuRecognitionProviderError("MENU_RECOGNITION_TIMEOUT", "GLM OCR 超时，请重试");
      throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", error instanceof Error ? error.message : "GLM OCR 不可用");
    } finally { clearTimeout(timeout); }
  }
}

const visionSystemPrompt = `你是菜单和外卖页面的视觉信息提取器。只提取图片中完整、可购买的食品或饮品商品卡片。
必须依据商品卡片的空间关系配对商品名与价格，不得把导航、状态栏、按钮、折扣标签、销量、配送费或孤立文字当成商品。
不得补充图片中不存在的商品，不得猜测看不清的价格。商品本身是套餐或组合时，页面与该商品卡片明确对应的整套现价就是可用价格，不要拆分或索要单品价格；神券价、券后价、补贴价、特价且页面显示已含券时，也可作为当前整套价格。只有起售价、会员资格价、多规格/任选价格或价格无法与商品唯一对应时，priceCents 才为 null 且 needsConfirmation 为 true。
输出纯 JSON，不要 Markdown。格式为 {"candidates":[...]}。每项仅包含 name、priceCents、priceText、description、visibleTags、confidence、rawTextReference、needsConfirmation、risks。
risks 只能使用 LOW_CONFIDENCE、IMAGE_BLURRY、PRICE_UNCERTAIN、MEMBER_PRICE、SET_PRICE。priceCents 使用人民币分。rawTextReference 必须引用图片中支持商品名与价格配对的可见文字。没有有效商品时返回 {"candidates":[]}。`;

function chatCompletionContent(payload: OpenAiChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.flatMap((part) => part.type === "text" && part.text ? [part.text] : []).join("\n").trim();
  return "";
}

function parseJsonContent(content: string): unknown {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(normalized) as unknown;
}

export class OpenAiCompatibleVisionMenuRecognitionProvider implements MenuRecognitionProvider {
  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async recognize(input: MenuRecognitionInput): Promise<unknown> {
    if (!input.image || !input.mimeType) throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", "多模态菜单识别缺少图片输入");
    const config = readModelConfig();
    if (!config.visionApiKey) throw new MenuRecognitionProviderError("MENU_RECOGNITION_NOT_CONFIGURED", "未配置多模态菜单模型 API Key");
    const controller = new AbortController();
    // Third-party gateways can spend additional time queueing and processing high-resolution images.
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await this.fetchImplementation(`${config.visionBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.visionApiKey}` },
        body: JSON.stringify({
          model: config.visionModel,
          messages: [
            { role: "system", content: visionSystemPrompt },
            { role: "user", content: [
              { type: "text", text: "识别这张菜单或外卖页面截图中的可购买商品卡片。" },
              { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.image}`, detail: "high" } },
            ] },
          ],
          temperature: 0,
          max_completion_tokens: 4_000,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", `多模态菜单模型返回 ${response.status}`, response.status);
      const content = chatCompletionContent(await response.json() as OpenAiChatCompletionResponse);
      if (!content) throw new Error("多模态菜单模型未返回内容");
      return parseJsonContent(content);
    } catch (error) {
      if (error instanceof MenuRecognitionProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new MenuRecognitionProviderError("MENU_RECOGNITION_TIMEOUT", "多模态菜单模型超时，请重试");
      throw new MenuRecognitionProviderError("MENU_RECOGNITION_UPSTREAM_ERROR", error instanceof Error ? error.message : "多模态菜单模型不可用");
    } finally { clearTimeout(timeout); }
  }
}

export async function testVisionConnection(fetchImplementation: typeof fetch = fetch) {
  const config = readModelConfig();
  if (!config.visionApiKey) throw new Error("未配置多模态菜单模型 API Key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImplementation(`${config.visionBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.visionApiKey}` },
      body: JSON.stringify({ model: config.visionModel, messages: [{ role: "user", content: "只回复 OK" }], max_completion_tokens: 16 }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`多模态模型连接返回 ${response.status}`);
    if (!chatCompletionContent(await response.json() as OpenAiChatCompletionResponse)) throw new Error("多模态模型响应为空");
    return { message: `多模态模型连接成功：${config.visionModel}` };
  } finally { clearTimeout(timeout); }
}

export function parseOcrMenuText(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const normalized = line.replace(/^\[x=[^\]]+\]\s*/, "").trim();
    if (!normalized) return [];
    if (/^(?:VPN|\(?|<?|外送|外卖|自取|预订|拼单|点餐|收藏|选规格|选套餐|热销|零售产品|甜品饮料|十大必点)$/i.test(normalized)) return [];
    if (/^(?:\d{1,2}:\d{2}|\d+(?:\.\d+)?\s*(?:KB\/s|MB\/s|GB|G|%))$/i.test(normalized)) return [];
    if (/^(?:温馨提示|收藏店铺|官方补贴|省薪专享|工作日省薪|镇店招牌)/.test(normalized)) return [];
    const price = normalized.match(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/);
    const name = normalized.replace(price?.[0] ?? "", "").replace(/[·•.。:：-]+$/g, "").trim();
    if (!name) return [];
    return [{
      name,
      priceCents: price ? Math.round(Number(price[1]) * 100) : null,
      priceText: price?.[0] ?? null,
      description: null,
      visibleTags: [],
      confidence: 0.8,
      rawTextReference: normalized,
      needsConfirmation: true,
      risks: ["PRICE_UNCERTAIN"],
    }];
  });
}

export const menuRecognitionProvider: MenuRecognitionProvider = new OpenAiCompatibleVisionMenuRecognitionProvider();
import { readModelConfig } from "@/server/model-config-store";
