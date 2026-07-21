import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recurringBillInputSchema } from "@/lib/recurring-bills";
import { requireApiUser } from "@/server/auth";
import { createRecurringBill, listRecurringBills } from "@/server/recurring-bill-store";

export const runtime = "nodejs";
function failure(error: unknown) { return NextResponse.json({ error: { code: "RECURRING_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "周期账单操作失败" } }, { status: 409 }); }
export async function GET() { try { const user = await requireApiUser(); return NextResponse.json({ data: listRecurringBills(user.id) }); } catch (error) { return failure(error); } }
export async function POST(request: NextRequest) { try { const user = await requireApiUser(); const id = createRecurringBill(user.id, recurringBillInputSchema.parse(await request.json())); return NextResponse.json({ data: { id } }, { status: 201 }); } catch (error) { return failure(error); } }
