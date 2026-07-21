import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountInputSchema } from "@/lib/accounts";
import { createAccount, listAccounts } from "@/server/account-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "ACCOUNT_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "账户操作失败" } }, { status: validation ? 400 : 409 });
}

export async function GET() {
  try { const user = await requireApiUser(); return NextResponse.json({ data: listAccounts(user.id) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try { const user = await requireApiUser(); const id = createAccount(user.id, accountInputSchema.parse(await request.json())); return NextResponse.json({ data: { id } }, { status: 201 }); }
  catch (error) { return failure(error); }
}
