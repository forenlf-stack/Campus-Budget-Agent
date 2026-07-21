import { describe, expect, it } from "vitest";

import { resolveImportedTransactionInputs, type ImportedTransactionInput } from "./transaction-store";

function imported(overrides: Partial<ImportedTransactionInput> & Pick<ImportedTransactionInput, "importTemporaryId" | "type">): ImportedTransactionInput {
  return {
    category: overrides.type === "INCOME" ? null : "MEAL",
    amountCents: 5_000,
    occurredAt: "2026-07-11T10:08:35.000Z",
    itemName: "测试交易",
    merchant: "测试商家",
    note: "",
    isFixedExpense: false,
    originalTransactionId: null,
    originalCandidateTemporaryId: null,
    ...overrides,
    importTemporaryId: overrides.importTemporaryId,
    type: overrides.type,
  };
}

describe("imported transaction reference resolution", () => {
  it("把同批次退款的临时关联转换成真实原支出 ID", () => {
    const ids = ["expense-database-id", "refund-database-id"];
    const result = resolveImportedTransactionInputs([
      imported({ importTemporaryId: "expense-preview-id", type: "EXPENSE" }),
      imported({ importTemporaryId: "refund-preview-id", type: "REFUND", originalCandidateTemporaryId: "expense-preview-id" }),
    ], () => ids.shift()!);

    expect(result.transactions[1]).toMatchObject({
      id: "refund-database-id",
      type: "REFUND",
      originalTransactionId: "expense-database-id",
    });
  });

  it("拒绝只选择退款但未选择本批次原支出", () => {
    expect(() => resolveImportedTransactionInputs([
      imported({ importTemporaryId: "refund-preview-id", type: "REFUND", originalCandidateTemporaryId: "missing-expense" }),
    ], () => "refund-database-id")).toThrow("原支出不存在或未被选中");
  });
});
