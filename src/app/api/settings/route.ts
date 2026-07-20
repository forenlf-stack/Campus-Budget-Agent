import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { settingsSchema } from "@/lib/settings";
import { requireApiUser } from "@/server/auth";
import { getCurrentPeriod, readSettings, saveSettings } from "@/server/settings-store";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "配置校验失败", fields: z.flattenError(error).fieldErrors } }, { status: 400 });
  }
  return NextResponse.json({ error: { code: "SETTINGS_ERROR", message: error instanceof Error ? error.message : "配置操作失败" } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const period = request.nextUrl.searchParams.get("period") ?? getCurrentPeriod();
    return NextResponse.json({ data: readSettings(user.id, period) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const data = settingsSchema.parse(await request.json());
    return NextResponse.json({ data: saveSettings(user.id, data) });
  } catch (error) {
    return errorResponse(error);
  }
}
