import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth";
import { listDeletedTransactions } from "@/server/transaction-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ data: listDeletedTransactions(user.id) });
  } catch (error) {
    return NextResponse.json({ error: { code: "TRASH_ERROR", message: error instanceof Error ? error.message : "读取回收站失败" } }, { status: 409 });
  }
}
