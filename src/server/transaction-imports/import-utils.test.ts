import { describe, expect, it } from "vitest";

import type { TransactionRecord } from "@/server/transaction-store";
import { candidate, detectType, inferCategory, markDuplicate, normalizeAmountCents, normalizeDate } from "./import-utils";

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
});
