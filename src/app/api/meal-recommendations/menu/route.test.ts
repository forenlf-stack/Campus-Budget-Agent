import { describe, expect, it, vi, beforeEach } from "vitest";

import { menuMealRecommendationResponseSchema } from "@/lib/menu-meal-recommendations";

vi.mock("@/server/workflows/menu-meal-recommendation", () => ({
  runMenuMealRecommendation: vi.fn(),
}));

import { runMenuMealRecommendation } from "@/server/workflows/menu-meal-recommendation";
import { POST, withMenuWorkflowTimeout } from "./route";

const mockedRun = vi.mocked(runMenuMealRecommendation);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function request(formData: FormData, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/meal-recommendations/menu", { method: "POST", body: formData, headers });
}

function readyResponse() {
  return {
    runId: "route-run", status: "READY" as const, source: "image" as const, mealPeriod: "LUNCH" as const,
    recognition: { source: "image" as const, detectedCount: 2, validCount: 2, rejectedCount: 0, warnings: [] },
    pendingConfirmation: [], rejectedCandidateCount: 0, recommendations: [],
    timing: { extractionMs: 1, contextMs: 2, rankingMs: 3, totalMs: 6 },
  };
}

describe("POST /api/meal-recommendations/menu", () => {
  beforeEach(() => mockedRun.mockReset());
  it("接受有效图片并返回工作流响应", async () => {
    mockedRun.mockResolvedValueOnce({ success: true, data: readyResponse() });
    const form = new FormData();
    form.append("image", new File([pngBytes], "menu.png", { type: "image/png" }));
    const response = await POST(request(form) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledWith(expect.objectContaining({ source: { type: "image", image: Buffer.from(pngBytes).toString("base64"), mimeType: "image/png" } }), expect.objectContaining({ store: expect.any(Object) }));
    expect(menuMealRecommendationResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("模型超时映射为504且可重试", async () => {
    mockedRun.mockResolvedValueOnce({ success: false, runId: "run", error: { code: "MENU_RECOGNITION_TIMEOUT", message: "timeout" } });
    const form = new FormData();
    form.append("menuText", "鸡腿饭 15元\n牛肉面 18元");
    const response = await POST(request(form) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: "MENU_RECOGNITION_TIMEOUT" }, retryable: true });
  });

  it("整体工作流超过硬截止时返回超时错误", async () => {
    await expect(withMenuWorkflowTimeout(new Promise(() => undefined), 1)).rejects.toMatchObject({
      name: "WorkflowTimeoutError",
      message: "菜单识别和推荐超过55秒，请重试或改用菜单文字",
    });
  });

  it("图片识别未配置时返回503并提示使用降级入口", async () => {
    mockedRun.mockResolvedValueOnce({ success: false, runId: "run", error: { code: "MENU_RECOGNITION_NOT_CONFIGURED", message: "未配置菜单图片识别服务" } });
    const form = new FormData();
    form.append("image", new File([pngBytes], "menu.png", { type: "image/png" }));
    const response = await POST(request(form) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "MENU_RECOGNITION_NOT_CONFIGURED" }, retryable: false });
  });

  it("拒绝非法JSON字段", async () => {
    const form = new FormData();
    form.append("menuText", "鸡腿饭 15元\n牛肉面 18元");
    form.append("quickTags", "{bad-json");
    const response = await POST(request(form) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("通过Content-Length提前拒绝超大图", async () => {
    const form = new FormData();
    form.append("image", new File([pngBytes], "menu.png", { type: "image/png" }));
    const response = await POST(request(form, { "content-length": String(7 * 1024 * 1024) }) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "IMAGE_TOO_LARGE" } });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("拒绝非法文件类型和伪造图片内容", async () => {
    const invalidType = new FormData();
    invalidType.append("image", new File(["text"], "menu.txt", { type: "text/plain" }));
    const typeResponse = await POST(request(invalidType) as Parameters<typeof POST>[0]);
    expect(typeResponse.status).toBe(415);
    expect(await typeResponse.json()).toMatchObject({ error: { code: "UNSUPPORTED_IMAGE_TYPE" } });

    const fakeImage = new FormData();
    fakeImage.append("image", new File(["not-png"], "menu.png", { type: "image/png" }));
    const contentResponse = await POST(request(fakeImage) as Parameters<typeof POST>[0]);
    expect(contentResponse.status).toBe(415);
    expect(await contentResponse.json()).toMatchObject({ error: { code: "INVALID_IMAGE_CONTENT" } });
  });

  it("兼容对象形式确认价格并转为工作流数组契约", async () => {
    mockedRun.mockResolvedValueOnce({ success: true, data: readyResponse() });
    const form = new FormData();
    form.append("image", new File([pngBytes], "menu.png", { type: "image/png" }));
    form.append("confirmedPrices", JSON.stringify({ "vision-1": 1_500 }));
    const response = await POST(request(form) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledWith(expect.objectContaining({ confirmedPrices: [{ temporaryId: "vision-1", priceCents: 1_500 }] }), expect.objectContaining({ store: expect.any(Object) }));
  });
});
