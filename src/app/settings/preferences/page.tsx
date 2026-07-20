import type { Metadata } from "next";

import { SettingsForm } from "./settings-form";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = {
  title: "资金与偏好设置",
  description: "设置总消费预算、资金背景和消费偏好",
};

export default async function PreferencesPage() {
  await requireUser();
  return <SettingsForm />;
}
