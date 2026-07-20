import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { registerInputSchema } from "@/lib/auth";
import { createSession, registerUser } from "@/server/auth-store";
import { sessionCookieName } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const input = registerInputSchema.parse(await request.json());
    const user = await registerUser(input);
    const session = createSession(user.id);
    (await cookies()).set(sessionCookieName, session.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", expires: session.expiresAt, priority: "high",
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "REGISTER_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "注册失败" } }, { status: validation ? 400 : 409 });
  }
}
