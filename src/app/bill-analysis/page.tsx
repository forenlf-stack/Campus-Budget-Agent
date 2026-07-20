import type { Metadata } from "next";

import { BillAnalysisClient } from "./bill-analysis-client";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "账单分析与建议", description: "分析消费结构、周期变化和高支出时段" };

export default async function BillAnalysisPage() {
  await requireUser();
  return <BillAnalysisClient />;
}
