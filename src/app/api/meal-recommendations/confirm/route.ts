import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { confirmMealDecisionInputSchema, confirmMealDecisionResponseSchema } from "@/lib/meal-decisions";
import { confirmMealPurchase } from "@/server/skills/confirm-meal-purchase";
import { requireApiUser } from "@/server/auth";
import { createSkillReadStore } from "@/server/skill-read-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = confirmMealDecisionInputSchema.parse(await request.json());
    const result = confirmMealPurchase(user.id, input, { store: createSkillReadStore(user.id) });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json(confirmMealDecisionResponseSchema.parse(result.data), { status: result.data.idempotent ? 200 : 201 });
  } catch (error) {
    const validation = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({
      error: {
        code: validation ? "VALIDATION_ERROR" : "CONFIRM_MEAL_PURCHASE_ERROR",
        message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "确认餐食消费失败",
      },
    }, { status: validation ? 400 : 500 });
  }
}
