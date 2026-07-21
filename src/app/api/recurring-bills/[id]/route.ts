import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth";
import { deleteRecurringBill } from "@/server/recurring-bill-store";

export const runtime = "nodejs";
export async function DELETE(_request: Request, context: RouteContext<"/api/recurring-bills/[id]">) { try { const user = await requireApiUser(); const { id } = await context.params; deleteRecurringBill(user.id, id); return NextResponse.json({ data: { id } }); } catch (error) { return NextResponse.json({ error: { code: "RECURRING_ERROR", message: error instanceof Error ? error.message : "删除周期账单失败" } }, { status: 409 }); } }
