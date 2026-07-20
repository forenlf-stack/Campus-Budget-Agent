import type { Metadata } from "next";

import { TransactionImportsClient } from "./transaction-imports-client";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "导入交易记录", description: "主动导入文字、图片和 Excel 账单并预览确认" };

export default async function TransactionImportsPage() {
  await requireUser();
  return <TransactionImportsClient />;
}
