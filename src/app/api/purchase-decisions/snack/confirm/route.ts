import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { confirmSnackPurchaseInputSchema, confirmSnackPurchaseResponseSchema } from "@/lib/snack-decisions";
import { requireApiUser } from "@/server/auth";
import { recordSnackPurchase } from "@/server/snack-decision-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = confirmSnackPurchaseInputSchema.parse(await request.json());
    return NextResponse.json(confirmSnackPurchaseResponseSchema.parse(recordSnackPurchase(user.id, input)), { status: 201 });
  } catch (error) {
    const validation = error instanceof z.ZodError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "SNACK_CONFIRM_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "确认零食购买失败" } }, { status: validation ? 400 : 409 });
  }
}
