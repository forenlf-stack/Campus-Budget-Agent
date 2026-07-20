import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthUser } from "@/lib/auth";
import { readSession } from "@/server/auth-store";

export const sessionCookieName = "budget_session";

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  return token ? readSession(token) : null;
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireApiUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
