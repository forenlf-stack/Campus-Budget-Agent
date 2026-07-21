import { readFileSync } from "node:fs";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { linkRefundCandidates } from "./import-utils";
import { parseSpreadsheet } from "./spreadsheet-parser";

function createWechatWorkbook() {
  const rows = [
    ["微信支付账单明细"],
    ["导出说明"],
    [],
    ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号"],
    ["2026-07-18 12:30:00", "商户消费", "午餐店", "午餐", "支出", "¥20.50", "零钱", "支付成功", "sensitive-id-1"],
    ["2026-07-18 12:35:00", "商户消费", "午餐店", "加餐", "支出", "¥8.00", "零钱", "已全额退款", "sensitive-id-original-refunded"],
    ["2026-07-18 13:30:00", "商户消费-退款", "午餐店", "加餐退款", "收入", "¥8.00", "零钱", "已全额退款", "sensitive-id-2"],
    ["2026-07-18 14:30:00", "零钱提现", "", "零钱提现", "/", "¥100.00", "", "提现已到账", "sensitive-id-3"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

describe("spreadsheet transaction parser", () => {
  it("识别带说明前缀的微信支付账单，并跳过中性资金划转", () => {
    const result = parseSpreadsheet(createWechatWorkbook());
    expect(result.candidates).toHaveLength(3);
    expect(result.rejectedCount).toBe(1);
    expect(result.candidates.map((item) => item.type)).toEqual(["EXPENSE", "EXPENSE", "REFUND"]);
    expect(result.candidates[0]).toMatchObject({ amountCents: 2050, merchant: "午餐店", itemName: "午餐" });
    expect(result.candidates[0].rawReference).not.toContain("sensitive-id-1");
  });

  it("将退款行关联到同一预览中的原支出", () => {
    const result = parseSpreadsheet(createWechatWorkbook());
    const candidates = linkRefundCandidates(result.candidates, []);
    const expense = candidates.find((item) => item.type === "EXPENSE" && item.amountCents === 800);
    const refund = candidates.find((item) => item.type === "REFUND");

    expect(expense).toBeDefined();
    expect(refund).toMatchObject({
      amountCents: 800,
      category: expense?.category,
      originalCandidateTemporaryId: expense?.temporaryId,
      originalTransactionId: null,
      needsReview: false,
    });
  });

  it.skipIf(!process.env.PRIVATE_BILL_PATH)("可解析本地真实微信账单且不输出流水内容", () => {
    const result = parseSpreadsheet(readFileSync(process.env.PRIVATE_BILL_PATH!));
    const linked = linkRefundCandidates(result.candidates, []);
    expect(result.candidates).toHaveLength(325);
    expect(result.rejectedCount).toBe(4);
    expect(result.candidates.every((item) => item.amountCents > 0 && item.occurredAt.length > 0)).toBe(true);
    expect(result.candidates.filter((item) => item.type === "EXPENSE")).toHaveLength(293);
    expect(result.candidates.filter((item) => item.type === "INCOME")).toHaveLength(27);
    expect(result.candidates.filter((item) => item.type === "REFUND")).toHaveLength(5);
    expect(linked.filter((item) => item.type === "REFUND" && item.originalCandidateTemporaryId)).toHaveLength(5);
  });
});
