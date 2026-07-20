import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transactionInputSchema } from "@/lib/transactions";
import { deleteTransaction, updateTransaction } from "@/server/transaction-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "TRANSACTION_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "交易操作失败" } }, { status: validation ? 400 : 409 });
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/transactions/[id]">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    updateTransaction(user.id, id, transactionInputSchema.parse(await request.json()));
    return NextResponse.json({ data: { id } });
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/transactions/[id]">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    deleteTransaction(user.id, id);
    return NextResponse.json({ data: { id } });
  } catch (error) { return failure(error); }
}
