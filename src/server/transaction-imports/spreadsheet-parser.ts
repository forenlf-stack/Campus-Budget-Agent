import * as XLSX from "xlsx";

import type { ImportedTransactionCandidate } from "@/lib/transaction-imports";
import { candidate, detectType, normalizeAmountCents, normalizeDate } from "./import-utils";

const maximumCandidates = 1000;
const maximumSheetRows = 2001;

function normalizedHeader(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, "").trim();
}

function findHeaderRow(rows: unknown[][]) {
  return rows.slice(0, 100).findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.some((header) => /交易时间|支付时间|日期|入账时间/.test(header))
      && headers.some((header) => /金额/.test(header));
  });
}

function findValue(row: Record<string, unknown>, patterns: RegExp[]) {
  const entry = Object.entries(row).find(([key]) => patterns.some((pattern) => pattern.test(normalizedHeader(key))));
  return entry?.[1];
}

function rowCandidate(row: Record<string, unknown>, index: number): ImportedTransactionCandidate | null {
  const dateValue = findValue(row, [/交易时间|支付时间|时间|日期|创建时间|入账时间/i]);
  const amountValue = findValue(row, [/^金额(?:\(元\))?$|交易金额|收支金额|付款金额/i]);
  const merchantValue = findValue(row, [/交易对方|商户|商家|收款方|付款方|对方名称/i]);
  const itemValue = findValue(row, [/^商品$|商品名称|交易内容|摘要|说明/i]);
  const transactionTypeValue = findValue(row, [/交易类型/i]);
  const statusValue = findValue(row, [/交易状态|当前状态|^状态$/i]);
  const directionValue = findValue(row, [/收\/支|收支|资金方向|^类型$/i]);
  const direction = String(directionValue ?? "").trim();

  // 微信的“/”表示零钱提现等中性资金划转，不应计入消费预算。
  if (/^(?:\/|不计收支|中性交易)$/.test(direction)) return null;

  const occurredAt = normalizeDate(dateValue);
  const amountCents = normalizeAmountCents(amountValue);
  if (!occurredAt || !amountCents) return null;

  const merchant = String(merchantValue ?? "").trim().slice(0, 100);
  const itemName = String(itemValue ?? (merchant || `导入交易${index + 1}`)).trim().slice(0, 100);
  // “已全额退款”也会出现在原消费行；退款类型必须由交易类型/收支方向判断，
  // 否则原消费与独立退款流水都会被算成退款。
  const typeText = `${transactionTypeValue ?? ""} ${direction}`;
  const rawReference = JSON.stringify({
    date: dateValue,
    transactionType: transactionTypeValue,
    merchant,
    itemName,
    direction,
    amount: amountValue,
    status: statusValue,
  }).slice(0, 1000);

  return candidate({
    source: "SPREADSHEET",
    type: detectType(typeText, amountValue),
    amountCents,
    occurredAt,
    itemName,
    merchant,
    rawReference,
    confidence: merchant || itemValue ? 0.95 : 0.75,
  });
}

export function parseSpreadsheet(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false, sheetRows: maximumSheetRows });
  const candidates: ImportedTransactionCandidate[] = [];
  const warnings: string[] = [];
  let rejectedCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) {
      warnings.push(`工作表“${sheetName}”未找到包含时间和金额的表头，已跳过。`);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
      range: headerRow,
    });
    const remaining = Math.max(0, maximumCandidates - candidates.length);
    for (const [index, row] of rows.slice(0, remaining).entries()) {
      if (!Object.values(row).some((value) => String(value ?? "").trim())) continue;
      const parsed = rowCandidate(row, index);
      if (parsed) candidates.push(parsed);
      else rejectedCount += 1;
    }
  }

  if (workbook.SheetNames.length > 1) warnings.push(`已读取 ${workbook.SheetNames.length} 个工作表。`);
  if (candidates.length >= maximumCandidates) warnings.push("单次最多预览 1000 条记录，其余记录请拆分文件导入。");
  if (rejectedCount > 0) warnings.push(`有 ${rejectedCount} 条记录因缺少有效时间、金额或属于中性资金划转而未导入。`);

  return { candidates, rejectedCount, warnings };
}
