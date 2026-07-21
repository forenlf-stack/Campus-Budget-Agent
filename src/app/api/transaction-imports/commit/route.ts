import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transactionImportCommitSchema } from "@/lib/transaction-imports";
import { requireApiUser } from "@/server/auth";
import { createImportedTransactions } from "@/server/transaction-store";
import { deleteImportPreview, readImportPreview } from "@/server/transaction-imports/transaction-import-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const input = transactionImportCommitSchema.parse(await request.json());
    const preview = readImportPreview(user.id, input.importId);
    if (!preview) return NextResponse.json({ error: { code: "IMPORT_EXPIRED", message: "导入预览已过期，请重新解析" } }, { status: 410 });

    const previewById = new Map(preview.candidates.map((item) => [item.temporaryId, item]));
    const seen = new Set<string>();
    const transactions = input.transactions.map((item) => {
      const original = previewById.get(item.temporaryId);
      if (!original) throw new Error("提交内容包含不属于当前预览的记录");
      if (seen.has(item.temporaryId)) throw new Error("同一预览记录不能重复提交");
      seen.add(item.temporaryId);
      if (item.type === "REFUND" && !item.originalTransactionId && !item.originalCandidateTemporaryId) throw new Error("退款必须关联原支出，请先在预览中确认关联");
      if (item.originalCandidateTemporaryId && !previewById.has(item.originalCandidateTemporaryId)) throw new Error("退款关联的原支出不属于当前预览");
      return {
        importTemporaryId: item.temporaryId,
        type: item.type,
        category: item.type === "INCOME" ? null : item.category,
        amountCents: item.amountCents,
        occurredAt: item.occurredAt,
        itemName: item.itemName,
        merchant: item.merchant,
        rawMerchant: original.rawMerchant || original.merchant,
        rawItemName: original.rawItemName || original.itemName,
        rawReference: [original.rawMerchant, original.rawItemName].filter(Boolean).join(" · ") || null,
        note: item.note,
        isFixedExpense: item.isFixedExpense,
        originalTransactionId: item.originalTransactionId,
        originalCandidateTemporaryId: item.originalCandidateTemporaryId,
        accountId: item.accountId ?? null,
      };
    });
    const ids = createImportedTransactions(user.id, transactions);
    deleteImportPreview(user.id, input.importId);
    return NextResponse.json({ data: { importedCount: ids.length, ids } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: { code: error instanceof z.ZodError ? "VALIDATION_ERROR" : "IMPORT_COMMIT_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "账单导入失败" } }, { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
