import type { Metadata } from "next";

import { BuyOrNotClient } from "./purchase-decision-client";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = {
  title: "买不买 | 学生消费助手",
  description: "结合近期频率和总预算判断零食饮料是否适合购买",
};

export default async function BuyOrNotPage() {
  await requireUser();
  return <BuyOrNotClient />;
}
