import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mealCandidateInputSchema } from "@/lib/meal-candidates";
import { disableMealCandidate, updateMealCandidate } from "@/server/meal-candidate-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "MEAL_CANDIDATE_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "餐食候选操作失败" } }, { status: validation ? 400 : 404 });
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/meal-candidates/[id]">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    updateMealCandidate(user.id, id, mealCandidateInputSchema.parse(await request.json()));
    return NextResponse.json({ data: { id } });
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/meal-candidates/[id]">) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    disableMealCandidate(user.id, id);
    return NextResponse.json({ data: { id, enabled: false } });
  } catch (error) { return failure(error); }
}
