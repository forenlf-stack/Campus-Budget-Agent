import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { importedTransactionCandidateSchema, transactionImportPreviewSchema } from "@/lib/transaction-imports";
import { requireApiUser } from "@/server/auth";
import { listTransactionsBetween } from "@/server/transaction-store";
import { parseTransactionImage } from "@/server/transaction-imports/image-parser";
import { markDuplicate, profileSignals } from "@/server/transaction-imports/import-utils";
import { saveImportPreview } from "@/server/transaction-imports/transaction-import-store";
import { parseSpreadsheet } from "@/server/transaction-imports/spreadsheet-parser";
import { parseTransactionText } from "@/server/transaction-imports/text-parser";

export const runtime = "nodejs";

const maxFileBytes = 12 * 1024 * 1024;
const allowedImages = ["image/jpeg", "image/png", "image/webp"];
const allowedSheets = [".xlsx", ".xls", ".csv", ".tsv"];

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const text = typeof form.get("text") === "string" ? String(form.get("text")).trim() : "";
    const file = form.get("file") instanceof File ? form.get("file") as File : null;
    if (Boolean(text) === Boolean(file)) return NextResponse.json({ error: { code: "INVALID_SOURCE", message: "请提供文字或一个账单文件" } }, { status: 400 });

    let result: Awaited<ReturnType<typeof parseTransactionText>>;
    let source: "TEXT" | "IMAGE" | "SPREADSHEET";
    if (text) {
      if (text.length > 100_000) throw new Error("文字账单不能超过 10 万字符");
      result = await parseTransactionText(text);
      source = "TEXT";
    } else if (file) {
      if (file.size === 0 || file.size > maxFileBytes) return NextResponse.json({ error: { code: "INVALID_FILE_SIZE", message: "文件必须小于 12MB 且不能为空" } }, { status: 413 });
      const name = file.name.toLowerCase();
      const bytes = Buffer.from(await file.arrayBuffer());
      if (allowedImages.includes(file.type)) {
        result = await parseTransactionImage(bytes.toString("base64"), file.type);
        source = "IMAGE";
      } else if (allowedSheets.some((extension) => name.endsWith(extension))) {
        result = parseSpreadsheet(bytes);
        source = "SPREADSHEET";
      } else {
        return NextResponse.json({ error: { code: "UNSUPPORTED_FILE", message: "仅支持 JPG、PNG、WebP、XLSX、XLS、CSV 和 TSV" } }, { status: 415 });
      }
    } else {
      throw new Error("缺少导入来源");
    }

    const existing = listTransactionsBetween(user.id, new Date(Date.now() - 3 * 365 * 86_400_000), new Date(Date.now() + 86_400_000));
    const candidates = result.candidates.map((item) => markDuplicate(importedTransactionCandidateSchema.parse(item), existing));
    const preview = saveImportPreview(user.id, { source, candidates, rejectedCount: result.rejectedCount, warnings: result.warnings, profileSignals: profileSignals(candidates) });
    return NextResponse.json(transactionImportPreviewSchema.parse(preview));
  } catch (error) {
    return NextResponse.json({ error: { code: error instanceof z.ZodError ? "VALIDATION_ERROR" : "IMPORT_PREVIEW_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "账单预览失败" } }, { status: 400 });
  }
}
