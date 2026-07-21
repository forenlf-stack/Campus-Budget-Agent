import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth";
import { deleteClassificationRule, listClassificationRules } from "@/server/classification-rule-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ data: listClassificationRules(user.id) });
  } catch (error) {
    return NextResponse.json({ error: { code: "RULE_ERROR", message: error instanceof Error ? error.message : "读取规则失败" } }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { id?: string };
    if (!body.id) throw new Error("缺少规则标识");
    deleteClassificationRule(user.id, body.id);
    return NextResponse.json({ data: { id: body.id } });
  } catch (error) {
    return NextResponse.json({ error: { code: "RULE_ERROR", message: error instanceof Error ? error.message : "删除规则失败" } }, { status: 409 });
  }
}
