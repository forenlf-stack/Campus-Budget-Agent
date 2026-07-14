import { randomUUID } from "node:crypto";

import {
  calculateCategoryUsage,
  calculateNetVariableSpending,
  calculateRemainingBudget,
  type BudgetTransaction,
  type TransactionCategory,
  type TransactionType,
} from "@/lib/budget";
import { readSettings } from "@/server/settings-store";
import { openDatabase, singleUserId } from "@/server/database";
import { transactionInputSchema, transactionQuerySchema, type TransactionInput, type TransactionQuery } from "@/lib/transactions";

interface TransactionRow {
  id: string;
  type: TransactionType;
  category: TransactionCategory | null;
  amountCents: number;
  itemName: string;
  merchant: string | null;
  occurredAt: string;
  note: string | null;
  isFixedExpense: number;
  originalTransactionId: string | null;
}

export interface TransactionRecord extends Omit<TransactionRow, "isFixedExpense"> {
  isFixedExpense: boolean;
}

function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${period}-01T00:00:00.000Z`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000Z`,
  };
}

function toRecord(row: TransactionRow): TransactionRecord {
  return { ...row, isFixedExpense: Boolean(row.isFixedExpense) };
}

function validateRefund(database: ReturnType<typeof openDatabase>, data: TransactionInput, editingId?: string) {
  if (data.type !== "REFUND" || !data.originalTransactionId) return;
  const original = database.prepare(`
    SELECT "id", "type", "category", "amountCents", "isFixedExpense"
    FROM "Transaction" WHERE "id" = ? AND "userId" = ?
  `).get(data.originalTransactionId, singleUserId) as { id: string; type: string; category: string; amountCents: number; isFixedExpense: number } | undefined;
  if (!original || original.type !== "EXPENSE") throw new Error("退款关联的原支出不存在");
  if (original.category !== data.category) throw new Error("退款分类必须与原支出一致");
  if (Boolean(original.isFixedExpense) !== data.isFixedExpense) throw new Error("退款的固定支出标记必须与原支出一致");
  const refunded = database.prepare(`
    SELECT COALESCE(SUM("amountCents"), 0) AS total FROM "Transaction"
    WHERE "type" = 'REFUND' AND "originalTransactionId" = ? AND "id" != ?
  `).get(original.id, editingId ?? "") as { total: number };
  if (refunded.total + data.amountCents > original.amountCents) throw new Error("累计退款金额不能超过原支出金额");
}

function budgetSummary(period: string, rows: TransactionRecord[]) {
  const settings = readSettings(period);
  const bounds = periodBounds(period);
  const transactions: BudgetTransaction[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    category: row.category,
    amountCents: row.amountCents,
    occurredAt: new Date(row.occurredAt),
    isFixedExpense: row.isFixedExpense,
  }));
  const periodInput = { transactions, periodStart: new Date(bounds.start), periodEnd: new Date(bounds.end) };
  const netVariableSpendingCents = calculateNetVariableSpending(periodInput);
  return {
    plannedVariableBudgetCents: settings.monthlyAllowanceCents - settings.fixedExpenseCents - settings.monthlySavingsTargetCents - settings.requiredReserveCents,
    netVariableSpendingCents,
    remainingBudgetCents: calculateRemainingBudget({
      plannedVariableBudgetCents: settings.monthlyAllowanceCents - settings.fixedExpenseCents - settings.monthlySavingsTargetCents - settings.requiredReserveCents,
      actualNetVariableSpendingCents: netVariableSpendingCents,
    }),
    categories: calculateCategoryUsage({ ...periodInput, categoryBudgets: settings.categoryBudgets }),
  };
}

export function listTransactions(query: TransactionQuery) {
  const parsed = transactionQuerySchema.parse(query);
  const database = openDatabase();
  try {
    const bounds = periodBounds(parsed.period);
    const filters = [`"userId" = ?`, `"occurredAt" >= ?`, `"occurredAt" < ?`];
    const parameters: Array<string> = [singleUserId, bounds.start, bounds.end];
    if (parsed.category) { filters.push(`"category" = ?`); parameters.push(parsed.category); }
    if (parsed.type) { filters.push(`"type" = ?`); parameters.push(parsed.type); }
    const visibleRows = database.prepare(`SELECT * FROM "Transaction" WHERE ${filters.join(" AND ")} ORDER BY "occurredAt" DESC, "createdAt" DESC`).all(...parameters) as unknown as TransactionRow[];
    const allRows = database.prepare(`SELECT * FROM "Transaction" WHERE "userId" = ? AND "occurredAt" >= ? AND "occurredAt" < ? ORDER BY "occurredAt" DESC`).all(singleUserId, bounds.start, bounds.end) as unknown as TransactionRow[];
    const refundableExpenses = database.prepare(`
      SELECT expense."id", expense."itemName", expense."category", expense."amountCents", expense."isFixedExpense",
             expense."amountCents" - COALESCE(SUM(refund."amountCents"), 0) AS "refundableCents"
      FROM "Transaction" expense
      LEFT JOIN "Transaction" refund ON refund."originalTransactionId" = expense."id" AND refund."type" = 'REFUND'
      WHERE expense."userId" = ? AND expense."type" = 'EXPENSE'
      GROUP BY expense."id" HAVING "refundableCents" > 0 ORDER BY expense."occurredAt" DESC
    `).all(singleUserId);
    return { transactions: visibleRows.map(toRecord), budget: budgetSummary(parsed.period, allRows.map(toRecord)), refundableExpenses };
  } finally { database.close(); }
}

export function createTransaction(input: TransactionInput) {
  const data = transactionInputSchema.parse(input);
  const database = openDatabase();
  try {
    validateRefund(database, data);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO "Transaction" ("id", "userId", "type", "category", "source", "amountCents", "occurredAt", "itemName", "merchant", "note", "isFixedExpense", "originalTransactionId", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, singleUserId, data.type, data.category, data.amountCents, data.occurredAt, data.itemName, data.merchant || null, data.note || null, data.isFixedExpense ? 1 : 0, data.originalTransactionId, now, now);
    return id;
  } finally { database.close(); }
}

export function updateTransaction(id: string, input: TransactionInput) {
  const data = transactionInputSchema.parse(input);
  const database = openDatabase();
  try {
    const current = database.prepare(`SELECT "type" FROM "Transaction" WHERE "id" = ? AND "userId" = ?`).get(id, singleUserId) as { type: string } | undefined;
    if (!current) throw new Error("消费记录不存在");
    const refunds = database.prepare(`SELECT COUNT(*) AS count FROM "Transaction" WHERE "originalTransactionId" = ?`).get(id) as { count: number };
    if (refunds.count > 0 && data.type !== "EXPENSE") throw new Error("已有退款的原支出不能改变类型");
    validateRefund(database, data, id);
    database.prepare(`
      UPDATE "Transaction" SET "type" = ?, "category" = ?, "amountCents" = ?, "occurredAt" = ?, "itemName" = ?, "merchant" = ?, "note" = ?, "isFixedExpense" = ?, "originalTransactionId" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "userId" = ?
    `).run(data.type, data.category, data.amountCents, data.occurredAt, data.itemName, data.merchant || null, data.note || null, data.isFixedExpense ? 1 : 0, data.originalTransactionId, new Date().toISOString(), id, singleUserId);
  } finally { database.close(); }
}

export function deleteTransaction(id: string) {
  const database = openDatabase();
  try {
    const refunds = database.prepare(`SELECT COUNT(*) AS count FROM "Transaction" WHERE "originalTransactionId" = ?`).get(id) as { count: number };
    if (refunds.count > 0) throw new Error("该支出已有退款记录，请先删除关联退款");
    const result = database.prepare(`DELETE FROM "Transaction" WHERE "id" = ? AND "userId" = ?`).run(id, singleUserId);
    if (result.changes !== 1) throw new Error("消费记录不存在");
  } finally { database.close(); }
}
