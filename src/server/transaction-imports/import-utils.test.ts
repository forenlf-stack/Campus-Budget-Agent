import { describe, expect, it } from "vitest";

import type { TransactionRecord } from "@/server/transaction-store";
import { candidate, detectType, inferCategory, linkRefundCandidates, markDuplicate, normalizeAmountCents, normalizeDate } from "./import-utils";

describe("transaction import utils", () => {
  it("解析常见金额、日期和交易类型", () => {
    expect(normalizeAmountCents("¥1,234.56元")).toBe(123_456);
    expect(normalizeAmountCents("￥12.00")).toBe(1_200);
    expect(normalizeDate("2026-07-18 12:30")).toBe("2026-07-18T04:30:00.000Z");
    expect(detectType("退款到账")).toBe("REFUND");
    expect(detectType("工资收入")).toBe("INCOME");
    expect(detectType("群收款 支出")).toBe("EXPENSE");
  });

  it("按描述推断消费分类", () => {
    expect(inferCategory("麦当劳午餐")).toBe("MEAL");
    expect(inferCategory("地铁乘车")).toBe("TRANSPORT");
  });

  it("检测金额、时间和商家接近的重复记录", () => {
    const imported = candidate({ source: "TEXT", amountCents: 2_000, occurredAt: "2026-07-18T04:30:00.000Z", itemName: "午餐", merchant: "麦当劳", rawReference: "午餐20元" });
    const existing: TransactionRecord[] = [{ id: "existing", type: "EXPENSE", category: "MEAL", amountCents: 2_000, occurredAt: "2026-07-18T04:31:00.000Z", itemName: "午餐", merchant: "麦当劳", note: null, isFixedExpense: false, originalTransactionId: null }];
    expect(markDuplicate(imported, existing)).toMatchObject({ duplicateStatus: "POSSIBLE_DUPLICATE", needsReview: true });
  });

  it("优先把退款关联到已存在的重复原支出，避免重复导入支出", () => {
    const existing: TransactionRecord[] = [{ id: "existing-expense", type: "EXPENSE", category: "MEAL", amountCents: 5_000, occurredAt: "2026-07-11T10:08:35.000Z", itemName: "美团收银", merchant: "西塔婆婆生蚝烤肉自助", note: null, isFixedExpense: false, originalTransactionId: null }];
    const expense = markDuplicate(candidate({ temporaryId: "candidate-expense", source: "SPREADSHEET", type: "EXPENSE", amountCents: 5_000, occurredAt: "2026-07-11T10:08:35.000Z", itemName: "美团收银", merchant: "西塔婆婆生蚝烤肉自助", rawReference: "已全额退款" }), existing);
    const refund = candidate({ temporaryId: "candidate-refund", source: "SPREADSHEET", type: "REFUND", amountCents: 5_000, occurredAt: "2026-07-11T11:29:02.000Z", itemName: "西塔婆婆生蚝烤肉自助", merchant: "西塔婆婆生蚝烤肉自助", rawReference: "已全额退款" });
    const linked = linkRefundCandidates([expense, refund], existing);

    expect(linked.find((item) => item.type === "REFUND")).toMatchObject({
      originalTransactionId: "existing-expense",
      originalCandidateTemporaryId: null,
      needsReview: false,
    });
  });
});
