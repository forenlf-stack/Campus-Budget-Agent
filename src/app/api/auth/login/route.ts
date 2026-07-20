import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loginInputSchema } from "@/lib/auth";
import { createSession, authenticateUser } from "@/server/auth-store";
import { sessionCookieName } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const input = loginInputSchema.parse(await request.json());
    const user = await authenticateUser(input);
    if (!user) return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "邮箱或密码不正确" } }, { status: 401 });
    const session = createSession(user.id);
    (await cookies()).set(sessionCookieName, session.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", expires: session.expiresAt, priority: "high",
    });
    return NextResponse.json({ user });
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "LOGIN_ERROR", message: validation ? error.issues[0]?.message : "登录失败" } }, { status: validation ? 400 : 500 });
  }
}
