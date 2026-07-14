import type { Metadata } from "next";

import { TransactionsClient } from "./transactions-client";

export const metadata: Metadata = { title: "消费记录", description: "添加、编辑、删除和查询消费记录" };

export default function TransactionsPage() {
  return <TransactionsClient />;
}
