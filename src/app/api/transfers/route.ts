import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transferInputSchema } from "@/lib/accounts";
import { createTransfer, listTransfers } from "@/server/account-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "TRANSFER_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "转账操作失败" } }, { status: validation ? 400 : 409 });
}

export async function GET(request: NextRequest) {
  try { const user = await requireApiUser(); return NextResponse.json({ data: listTransfers(user.id, request.nextUrl.searchParams.get("period") ?? undefined) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try { const user = await requireApiUser(); const id = createTransfer(user.id, transferInputSchema.parse(await request.json())); return NextResponse.json({ data: { id } }, { status: 201 }); }
  catch (error) { return failure(error); }
}
