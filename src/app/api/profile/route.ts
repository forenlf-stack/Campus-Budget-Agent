import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountProfileInputSchema } from "@/lib/profile";
import { requireApiUser } from "@/server/auth";
import { readAccountProfile, updateAccountProfile } from "@/server/auth-store";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "账户资料校验失败", fields: z.flattenError(error).fieldErrors } }, { status: 400 });
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : "账户资料操作失败";
  return NextResponse.json({ error: { code: "PROFILE_ERROR", message } }, { status: message.includes("已被其他账户") ? 409 : 500 });
}

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ data: readAccountProfile(user.id) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = accountProfileInputSchema.parse(await request.json());
    return NextResponse.json({ data: updateAccountProfile(user.id, input) });
  } catch (error) { return errorResponse(error); }
}
