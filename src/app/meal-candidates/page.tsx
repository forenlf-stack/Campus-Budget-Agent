import type { Metadata } from "next";

import { MealCandidatesClient } from "./meal-candidates-client";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "个人餐饮候选库", description: "维护个人吃过和可选的餐食" };

export default async function MealCandidatesPage() {
  await requireUser();
  return <MealCandidatesClient />;
}
