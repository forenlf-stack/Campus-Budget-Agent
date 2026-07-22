import type { Metadata } from "next";

import { ProfileClient } from "./profile-client";
import { requireUser } from "@/server/auth";
import { readAccountProfile } from "@/server/auth-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "用户信息", description: "管理账户资料、密码、预算偏好与个性化设置" };

export default async function ProfilePage() {
  const user = await requireUser();
  return <ProfileClient initialProfile={readAccountProfile(user.id)} />;
}
