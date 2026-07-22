import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/server/model-config-store", () => ({
  readModelConfig: () => ({
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModel: "deepseek-v4-pro",
    deepseekApiKey: "test-key",
    glmBaseUrl: "https://open.bigmodel.cn/api",
    glmOcrModel: "hand_write",
    glmApiKey: "",
  }),
}));

import { callDeepSeekJson } from "./deepseek-client";

describe("deepseek_client", () => {
  it("轻量任务默认关闭思考且不发送reasoning_effort", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    await callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation });

    expect(requestBody).toMatchObject({ thinking: { type: "disabled" }, stream: false });
    expect(requestBody).not.toHaveProperty("reasoning_effort");
  });

  it("复杂任务仍可显式启用思考", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    await callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { thinking: "enabled", fetchImplementation });

    expect(requestBody).toMatchObject({ thinking: { type: "enabled" } });
  });

  it("瞬时失败后自动重试一次", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation }))
      .resolves.toEqual({ ok: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])("HTTP %s 不重试", async (status) => {
    const fetchImplementation = vi.fn(async () => new Response("error", { status })) as unknown as typeof fetch;

    await expect(callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation, retryDelayMs: 0 }))
      .rejects.toThrow(`DeepSeek 返回 ${status}`);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503])("HTTP %s 会重试", async (status) => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 }));

    await expect(callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation, retryDelayMs: 0 }))
      .resolves.toEqual({ ok: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("模型返回无效 JSON 时不重试", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })) as unknown as typeof fetch;

    await expect(callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation, retryDelayMs: 0 }))
      .rejects.toBeInstanceOf(SyntaxError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("模型返回不符合契约的 JSON 时不重试", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":false}" } }] }), { status: 200 })) as unknown as typeof fetch;

    await expect(callDeepSeekJson("system", "user", z.object({ ok: z.literal(true) }), { fetchImplementation, retryDelayMs: 0 }))
      .rejects.toBeInstanceOf(z.ZodError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
