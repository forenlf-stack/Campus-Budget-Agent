import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountInputSchema } from "@/lib/accounts";
import { updateAccount } from "@/server/account-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/accounts/[id]">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    updateAccount(user.id, id, accountInputSchema.parse(await request.json()));
    return NextResponse.json({ data: { id } });
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "ACCOUNT_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "账户更新失败" } }, { status: validation ? 400 : 409 });
  }
}
