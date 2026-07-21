import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth";
import { generateDueRecurringBills } from "@/server/recurring-bill-store";

export const runtime = "nodejs";
export async function POST() { try { const user = await requireApiUser(); return NextResponse.json({ data: generateDueRecurringBills(user.id) }); } catch (error) { return NextResponse.json({ error: { code: "RECURRING_ERROR", message: error instanceof Error ? error.message : "生成周期账单失败" } }, { status: 409 }); } }
