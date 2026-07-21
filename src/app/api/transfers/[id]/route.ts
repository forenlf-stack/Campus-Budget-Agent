import { NextRequest, NextResponse } from "next/server";

import { setTransferDeleted } from "@/server/account-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

async function mutate(context: RouteContext<"/api/transfers/[id]">, deleted: boolean) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    setTransferDeleted(user.id, id, deleted);
    return NextResponse.json({ data: { id, deleted } });
  } catch (error) {
    return NextResponse.json({ error: { code: "TRANSFER_ERROR", message: error instanceof Error ? error.message : "转账操作失败" } }, { status: 409 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/transfers/[id]">) { return mutate(context, true); }
export async function PATCH(_request: NextRequest, context: RouteContext<"/api/transfers/[id]">) { return mutate(context, false); }
