import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth";

export async function GET() {
  const user = await getCurrentUser();
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
}
