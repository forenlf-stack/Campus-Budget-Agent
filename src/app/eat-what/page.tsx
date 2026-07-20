import { EatWhatClient } from "./eat-what-client";
import { requireUser } from "@/server/auth";

export default async function EatWhatPage() {
  await requireUser();
  return <EatWhatClient />;
}
