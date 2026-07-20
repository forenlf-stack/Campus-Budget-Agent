import { describe, expect, it, vi } from "vitest";

import { FetchMenuRecognitionProvider, OpenAiCompatibleVisionMenuRecognitionProvider } from "@/server/menu-recognition/menu-recognition-provider";

vi.mock("@/server/model-config-store", () => ({
  readModelConfig: () => ({
    visionBaseUrl: "https://apinebula.com/v1",
    visionModel: "gpt-5.4-mini",
    visionApiKey: "vision-secret",
    glmBaseUrl: "https://open.bigmodel.cn/api",
    glmOcrModel: "hand_write",
    glmApiKey: "",
  }),
}));

describe("FetchMenuRecognitionProvider", () => {
  it("使用注入fetch发送请求且不访问外网", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const provider = new FetchMenuRecognitionProvider({
      endpoint: "https://recognition.invalid/menu",
      apiKey: "test-key",
      model: "test-model",
      fetchImplementation,
    });

    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/png" })).resolves.toEqual({ candidates: [] });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://recognition.invalid/menu");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "test-model", image: "private-image-data", mimeType: "image/png" });
  });

  it("超时后中止provider请求", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const provider = new FetchMenuRecognitionProvider({
      endpoint: "https://recognition.invalid/menu",
      timeoutMs: 1,
      fetchImplementation,
    });

    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/webp" })).rejects.toMatchObject({
      code: "MENU_RECOGNITION_TIMEOUT",
    });
  });

  it("未配置服务时返回稳定错误且不会调用fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new FetchMenuRecognitionProvider({ endpoint: "", fetchImplementation });

    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/png" })).rejects.toMatchObject({
      code: "MENU_RECOGNITION_NOT_CONFIGURED",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("上游非成功响应不会暴露响应正文", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive upstream body", { status: 502 }));
    const provider = new FetchMenuRecognitionProvider({ endpoint: "https://recognition.invalid/menu", fetchImplementation });

    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/png" })).rejects.toMatchObject({
      code: "MENU_RECOGNITION_UPSTREAM_ERROR",
      status: 502,
      message: "菜单识别服务返回 502",
    });
  });

  it("将过大的Provider超时配置限制为15秒", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const provider = new FetchMenuRecognitionProvider({
        endpoint: "https://recognition.invalid/menu",
        timeoutMs: 60_000,
        fetchImplementation,
      });
      const recognition = provider.recognize({ image: "private-image-data", mimeType: "image/png" });
      const rejection = expect(recognition).rejects.toMatchObject({ code: "MENU_RECOGNITION_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(fetchImplementation.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OpenAiCompatibleVisionMenuRecognitionProvider", () => {
  it("通过chat completions发送原始图片并解析JSON内容", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"candidates\":[{\"name\":\"鸡腿饭\"}]}\n```" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleVisionMenuRecognitionProvider(fetchImplementation);

    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/png" })).resolves.toEqual({ candidates: [{ name: "鸡腿饭" }] });
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://apinebula.com/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer vision-secret" });
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,private-image-data");
    expect(body).not.toHaveProperty("response_format");
  });

  it("不读取或暴露第三方错误正文", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive", { status: 401 }));
    const provider = new OpenAiCompatibleVisionMenuRecognitionProvider(fetchImplementation);
    await expect(provider.recognize({ image: "private-image-data", mimeType: "image/jpeg" })).rejects.toMatchObject({
      code: "MENU_RECOGNITION_UPSTREAM_ERROR",
      status: 401,
      message: "多模态菜单模型返回 401",
    });
  });
});
