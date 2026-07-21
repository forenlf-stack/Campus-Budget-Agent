import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth";
import { restoreTransaction } from "@/server/transaction-store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<"/api/transactions/[id]/restore">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    restoreTransaction(user.id, id);
    return NextResponse.json({ data: { id } });
  } catch (error) {
    return NextResponse.json({ error: { code: "RESTORE_ERROR", message: error instanceof Error ? error.message : "恢复失败" } }, { status: 409 });
  }
}
