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
});
