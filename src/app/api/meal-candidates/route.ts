import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mealCandidateInputSchema, mealCandidateQuerySchema } from "@/lib/meal-candidates";
import { createMealCandidate, listMealCandidates } from "@/server/meal-candidate-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

function failure(error: unknown) {
  const validation = error instanceof z.ZodError;
  return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "MEAL_CANDIDATE_ERROR", message: validation ? error.issues[0]?.message : error instanceof Error ? error.message : "餐食候选操作失败" } }, { status: validation ? 400 : 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const raw = Object.fromEntries(request.nextUrl.searchParams);
    return NextResponse.json({ data: listMealCandidates(user.id, mealCandidateQuerySchema.parse({ location: raw.location || undefined, mealPeriod: raw.mealPeriod || undefined, enabled: raw.enabled || undefined })) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const id = createMealCandidate(user.id, mealCandidateInputSchema.parse(await request.json()));
    return NextResponse.json({ data: { id } }, { status: 201 });
  } catch (error) { return failure(error); }
}
