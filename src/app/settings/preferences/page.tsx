import type { Metadata } from "next";

import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "资金与偏好设置",
  description: "设置资金背景、分类预算和消费偏好",
};

export default function PreferencesPage() {
  return <SettingsForm />;
}
