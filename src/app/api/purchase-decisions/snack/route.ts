import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { snackDecisionInputSchema, snackDecisionResponseSchema } from "@/lib/snack-decisions";
import { evaluateSnackPurchase } from "@/server/skills/evaluate-snack-purchase";
import { explainSnackDecisionWithLlm } from "@/server/llm/agent-reasoning";
import { requireApiUser } from "@/server/auth";
import { createSkillReadStore } from "@/server/skill-read-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = snackDecisionInputSchema.parse(await request.json());
    const result = evaluateSnackPurchase(input, createSkillReadStore(user.id));
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.error.code === "INVALID_INPUT" ? 400 : 500 });
    }
    let response = result.data;
    try {
      response = await explainSnackDecisionWithLlm(input, result.data);
    } catch (error) {
      console.warn("Snack decision Agent unavailable; using deterministic fallback.", error);
    }
    return NextResponse.json(snackDecisionResponseSchema.parse(response));
  } catch (error) {
    const validation = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "SNACK_DECISION_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "零食饮料购买判断失败" } }, { status: validation ? 400 : 500 });
  }
}
