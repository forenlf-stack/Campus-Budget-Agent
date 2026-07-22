import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { passwordChangeInputSchema } from "@/lib/profile";
import { requireApiUser } from "@/server/auth";
import { changeAccountPassword } from "@/server/auth-store";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = passwordChangeInputSchema.parse(await request.json());
    await changeAccountPassword(user.id, input.currentPassword, input.newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "密码校验失败", fields: z.flattenError(error).fieldErrors } }, { status: 400 });
    }
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "密码修改失败";
    return NextResponse.json({ error: { code: "PASSWORD_CHANGE_ERROR", message } }, { status: message === "当前密码不正确" ? 400 : 500 });
  }
}
