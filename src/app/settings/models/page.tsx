import type { Metadata } from "next";

import { ModelSettingsClient } from "./model-settings-client";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "模型配置 | 学生消费助手", description: "配置并测试 DeepSeek 与 GLM OCR" };

export default async function ModelSettingsPage() { await requireUser(); return <ModelSettingsClient />; }
