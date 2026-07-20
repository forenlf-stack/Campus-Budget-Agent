import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { modelSettingsPublicSchema, modelSettingsUpdateSchema } from "@/lib/model-settings";
import { publicModelConfig, saveModelConfig } from "@/server/model-config-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

export async function GET() {
  await requireApiUser();
  return NextResponse.json({ data: modelSettingsPublicSchema.parse(publicModelConfig()) });
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiUser();
    return NextResponse.json({ data: modelSettingsPublicSchema.parse(saveModelConfig(modelSettingsUpdateSchema.parse(await request.json()))) });
  } catch (error) {
    return NextResponse.json({ error: { code: "MODEL_SETTINGS_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "模型配置保存失败" } }, { status: 400 });
  }
}
