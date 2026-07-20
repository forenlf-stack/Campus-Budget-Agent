import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { deleteSession } from "@/server/auth-store";
import { sessionCookieName } from "@/server/auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) deleteSession(token);
  cookieStore.delete(sessionCookieName);
  return NextResponse.json({ ok: true });
}
