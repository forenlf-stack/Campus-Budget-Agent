import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transactionInputSchema, transactionQuerySchema } from "@/lib/transactions";
import { createTransaction, listTransactions } from "@/server/transaction-store";
import { getCurrentPeriod } from "@/server/settings-store";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "TRANSACTION_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "交易操作失败" } }, { status: validation ? 400 : 409 });
}

export function GET(request: NextRequest) {
  try {
    const raw = Object.fromEntries(request.nextUrl.searchParams);
    return NextResponse.json({ data: listTransactions(transactionQuerySchema.parse({ period: raw.period ?? getCurrentPeriod(), category: raw.category || undefined, type: raw.type || undefined })) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const id = createTransaction(transactionInputSchema.parse(await request.json()));
    return NextResponse.json({ data: { id } }, { status: 201 });
  } catch (error) { return failure(error); }
}
