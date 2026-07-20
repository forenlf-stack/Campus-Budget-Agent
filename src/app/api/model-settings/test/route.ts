import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readModelConfig } from "@/server/model-config-store";
import { testDeepSeekConnection } from "@/server/llm/deepseek-client";
import { testVisionConnection } from "@/server/menu-recognition/menu-recognition-provider";
import { requireApiUser } from "@/server/auth";

const inputSchema = z.object({ provider: z.enum(["deepseek", "glm", "vision"]) }).strict();

export async function POST(request: NextRequest) {
  try {
    await requireApiUser();
    const { provider } = inputSchema.parse(await request.json());
    if (provider === "deepseek") {
      const result = await testDeepSeekConnection();
      return NextResponse.json({ ok: true, message: result.message });
    }
    if (provider === "vision") {
      const result = await testVisionConnection();
      return NextResponse.json({ ok: true, message: result.message });
    }
    const config = readModelConfig();
    if (!config.glmApiKey) throw new Error("GLM OCR 尚未配置");
    return NextResponse.json({ ok: true, message: "GLM OCR 配置已保存；请在拍菜单页面上传图片进行真实识别测试" });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "连接测试失败" }, { status: 502 });
  }
}
