import { randomUUID } from "node:crypto";

import {
  calculateCategoryUsage,
  calculateNetVariableSpending,
  calculateRemainingBudget,
  transactionCategories,
  type BudgetTransaction,
  type TransactionCategory,
  type TransactionType,
} from "@/lib/budget";
import { readSettings } from "@/server/settings-store";
import { openDatabase } from "@/server/database";
import { transactionInputSchema, transactionQuerySchema, type TransactionInput, type TransactionQuery } from "@/lib/transactions";
import { shanghaiPeriodBounds } from "@/lib/period";
import { calculateBudgetForecast } from "@/lib/budget-forecast";
import { rememberClassificationRule } from "@/server/classification-rule-store";

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
  accountId?: string | null;
  rawMerchant?: string | null;
  rawItemName?: string | null;
  rawReference?: string | null;
  deletedAt?: string | null;
}

export interface TransactionRecord extends Omit<TransactionRow, "isFixedExpense"> {
  isFixedExpense: boolean;
}

export interface RefundableExpense {
  id: string;
  itemName: string;
  merchant: string | null;
  category: TransactionCategory;
  amountCents: number;
  refundableCents: number;
  isFixedExpense: number;
}

export interface ImportedTransactionInput extends TransactionInput {
  importTemporaryId: string;
  originalCandidateTemporaryId: string | null;
}

export function resolveImportedTransactionInputs(inputs: ImportedTransactionInput[], createId: () => string = randomUUID) {
  const temporaryIds = new Set(inputs.map((input) => input.importTemporaryId));
  if (temporaryIds.size !== inputs.length) throw new Error("导入记录的临时标识不能重复");
  const idsByTemporaryId = new Map(inputs.map((input) => [input.importTemporaryId, createId()]));
  const typeByTemporaryId = new Map(inputs.map((input) => [input.importTemporaryId, input.type]));
  const transactions = inputs.map((input) => {
    if (input.originalTransactionId && input.originalCandidateTemporaryId) throw new Error("退款不能同时关联已有支出和本次导入支出");
    if (input.originalCandidateTemporaryId && typeByTemporaryId.get(input.originalCandidateTemporaryId) !== "EXPENSE") throw new Error("退款关联的本次导入原支出不存在或未被选中");
    const originalTransactionId = input.originalCandidateTemporaryId ? idsByTemporaryId.get(input.originalCandidateTemporaryId) ?? null : input.originalTransactionId;
    return {
      id: idsByTemporaryId.get(input.importTemporaryId)!,
      importTemporaryId: input.importTemporaryId,
      ...transactionInputSchema.parse({ ...input, originalTransactionId }),
    };
  });
  return { transactions, idsByTemporaryId };
}

function toRecord(row: TransactionRow): TransactionRecord {
  return { ...row, isFixedExpense: Boolean(row.isFixedExpense) };
}

function validateRefund(database: ReturnType<typeof openDatabase>, userId: string, data: TransactionInput, editingId?: string) {
  if (data.type !== "REFUND" || !data.originalTransactionId) return;
  const original = database.prepare(`
    SELECT "id", "type", "category", "amountCents", "isFixedExpense"
    FROM "Transaction" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL
  `).get(data.originalTransactionId, userId) as { id: string; type: string; category: string; amountCents: number; isFixedExpense: number } | undefined;
  if (!original || original.type !== "EXPENSE") throw new Error("退款关联的原支出不存在");
  if (original.category !== data.category) throw new Error("退款分类必须与原支出一致");
  if (Boolean(original.isFixedExpense) !== data.isFixedExpense) throw new Error("退款的固定支出标记必须与原支出一致");
  const refunded = database.prepare(`
    SELECT COALESCE(SUM("amountCents"), 0) AS total FROM "Transaction"
    WHERE "type" = 'REFUND' AND "originalTransactionId" = ? AND "id" != ? AND "deletedAt" IS NULL
  `).get(original.id, editingId ?? "") as { total: number };
  if (refunded.total + data.amountCents > original.amountCents) throw new Error("累计退款金额不能超过原支出金额");
}

function validateAccount(database: ReturnType<typeof openDatabase>, userId: string, accountId?: string | null) {
  if (!accountId) return;
  const account = database.prepare(`SELECT "id" FROM "Account" WHERE "id"=? AND "userId"=? AND "archivedAt" IS NULL`).get(accountId, userId);
  if (!account) throw new Error("所选账户不存在或已停用");
}

function budgetSummary(userId: string, period: string, rows: TransactionRecord[]) {
  const settings = readSettings(userId, period);
  const bounds = shanghaiPeriodBounds(period);
  const transactions: BudgetTransaction[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    category: row.category,
    amountCents: row.amountCents,
    occurredAt: new Date(row.occurredAt),
    isFixedExpense: row.isFixedExpense,
  }));
  const periodInput = { transactions, periodStart: bounds.start, periodEnd: bounds.end };
  const plannedVariableBudgetCents = settings.totalBudgetCents;
  const netVariableSpendingCents = calculateNetVariableSpending(periodInput);
  const forecast = calculateBudgetForecast({ budgetCents: plannedVariableBudgetCents, spentCents: netVariableSpendingCents, periodStart: bounds.start, periodEnd: bounds.end });
  return {
    currentBalanceCents: settings.currentBalanceCents,
    plannedVariableBudgetCents,
    netVariableSpendingCents,
    remainingBudgetCents: calculateRemainingBudget({
      plannedVariableBudgetCents,
      actualNetVariableSpendingCents: netVariableSpendingCents,
    }),
    forecast,
    categories: calculateCategoryUsage({
      ...periodInput,
      categoryBudgets: transactionCategories.map((category) => ({ category, budgetCents: 0 })),
    }),
  };
}

export function listTransactions(userId: string, query: TransactionQuery) {
  const parsed = transactionQuerySchema.parse(query);
  const database = openDatabase();
  try {
    const bounds = shanghaiPeriodBounds(parsed.period);
    const start = bounds.start.toISOString();
    const end = bounds.end.toISOString();
    const filters = [`"userId" = ?`, `"occurredAt" >= ?`, `"occurredAt" < ?`, `"deletedAt" IS NULL`];
    const parameters: Array<string> = [userId, start, end];
    if (parsed.category) { filters.push(`"category" = ?`); parameters.push(parsed.category); }
    if (parsed.type) { filters.push(`"type" = ?`); parameters.push(parsed.type); }
    const visibleRows = database.prepare(`SELECT * FROM "Transaction" WHERE ${filters.join(" AND ")} ORDER BY "occurredAt" DESC, "createdAt" DESC`).all(...parameters) as unknown as TransactionRow[];
    const allRows = database.prepare(`SELECT * FROM "Transaction" WHERE "userId" = ? AND "occurredAt" >= ? AND "occurredAt" < ? AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC`).all(userId, start, end) as unknown as TransactionRow[];
    const refundableExpenses = database.prepare(`
      SELECT expense."id", expense."itemName", expense."merchant", expense."category", expense."amountCents", expense."isFixedExpense",
             expense."amountCents" - COALESCE(SUM(refund."amountCents"), 0) AS "refundableCents"
      FROM "Transaction" expense
      LEFT JOIN "Transaction" refund ON refund."originalTransactionId" = expense."id" AND refund."type" = 'REFUND' AND refund."deletedAt" IS NULL
      WHERE expense."userId" = ? AND expense."type" = 'EXPENSE' AND expense."deletedAt" IS NULL
      GROUP BY expense."id" HAVING "refundableCents" > 0 ORDER BY expense."occurredAt" DESC
    `).all(userId) as unknown as RefundableExpense[];
    return { transactions: visibleRows.map(toRecord), budget: budgetSummary(userId, parsed.period, allRows.map(toRecord)), refundableExpenses };
  } finally { database.close(); }
}

export function listTransactionsBetween(userId: string, start: Date, end: Date): TransactionRecord[] {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error("账单分析时间范围无效");
  const database = openDatabase();
  try {
    const rows = database.prepare(`SELECT * FROM "Transaction" WHERE "userId" = ? AND "occurredAt" >= ? AND "occurredAt" < ? AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC, "createdAt" DESC`).all(userId, start.toISOString(), end.toISOString()) as unknown as TransactionRow[];
    return rows.map(toRecord);
  } finally { database.close(); }
}

export function createTransaction(userId: string, input: TransactionInput) {
  const data = transactionInputSchema.parse(input);
  const database = openDatabase();
  try {
    validateAccount(database, userId, data.accountId);
    validateRefund(database, userId, data);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO "Transaction" ("id", "userId", "type", "category", "source", "amountCents", "occurredAt", "itemName", "merchant", "note", "isFixedExpense", "originalTransactionId", "accountId", "rawMerchant", "rawItemName", "rawReference", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, data.type, data.category, data.amountCents, data.occurredAt, data.itemName, data.merchant || null, data.note || null, data.isFixedExpense ? 1 : 0, data.originalTransactionId, data.accountId ?? null, data.rawMerchant ?? null, data.rawItemName ?? null, data.rawReference ?? null, now, now);
    if (data.rememberRule && data.category && data.merchant) rememberClassificationRule(userId, { merchant: data.rawMerchant || data.merchant, itemName: data.rawItemName || data.itemName, normalizedMerchant: data.merchant, category: data.category });
    return id;
  } finally { database.close(); }
}

export function createImportedTransactions(userId: string, inputs: ImportedTransactionInput[]) {
  const { transactions: data, idsByTemporaryId } = resolveImportedTransactionInputs(inputs);
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const now = new Date().toISOString();
    for (const item of [...data.filter((entry) => entry.type !== "REFUND"), ...data.filter((entry) => entry.type === "REFUND")]) {
      validateAccount(database, userId, item.accountId);
      validateRefund(database, userId, item);
      database.prepare(`
        INSERT INTO "Transaction" ("id", "userId", "type", "category", "source", "amountCents", "occurredAt", "itemName", "merchant", "note", "isFixedExpense", "originalTransactionId", "accountId", "rawMerchant", "rawItemName", "rawReference", "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, 'CSV', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(item.id, userId, item.type, item.category, item.amountCents, item.occurredAt, item.itemName, item.merchant || null, item.note || null, item.isFixedExpense ? 1 : 0, item.originalTransactionId, item.accountId ?? null, item.rawMerchant ?? null, item.rawItemName ?? null, item.rawReference ?? null, now, now);
    }
    database.exec("COMMIT");
    return inputs.map((input) => idsByTemporaryId.get(input.importTemporaryId)!);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may not have started. */ }
    throw error;
  } finally { database.close(); }
}

export function updateTransaction(userId: string, id: string, input: TransactionInput) {
  const data = transactionInputSchema.parse(input);
  const database = openDatabase();
  try {
    const current = database.prepare(`SELECT "type", "rawMerchant", "rawItemName" FROM "Transaction" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`).get(id, userId) as { type: string; rawMerchant: string | null; rawItemName: string | null } | undefined;
    if (!current) throw new Error("消费记录不存在");
    const refunds = database.prepare(`SELECT COUNT(*) AS count FROM "Transaction" WHERE "originalTransactionId" = ? AND "deletedAt" IS NULL`).get(id) as { count: number };
    if (refunds.count > 0 && data.type !== "EXPENSE") throw new Error("已有退款的原支出不能改变类型");
    validateRefund(database, userId, data, id);
    validateAccount(database, userId, data.accountId);
    database.prepare(`
      UPDATE "Transaction" SET "type" = ?, "category" = ?, "amountCents" = ?, "occurredAt" = ?, "itemName" = ?, "merchant" = ?, "note" = ?, "isFixedExpense" = ?, "originalTransactionId" = ?, "accountId" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "userId" = ?
    `).run(data.type, data.category, data.amountCents, data.occurredAt, data.itemName, data.merchant || null, data.note || null, data.isFixedExpense ? 1 : 0, data.originalTransactionId, data.accountId ?? null, new Date().toISOString(), id, userId);
    if (data.rememberRule && data.category && data.merchant) rememberClassificationRule(userId, { merchant: current.rawMerchant || data.merchant, itemName: current.rawItemName || data.itemName, normalizedMerchant: data.merchant, category: data.category });
  } finally { database.close(); }
}

export function deleteTransaction(userId: string, id: string) {
  const database = openDatabase();
  try {
    const refunds = database.prepare(`SELECT COUNT(*) AS count FROM "Transaction" WHERE "originalTransactionId" = ? AND "deletedAt" IS NULL`).get(id) as { count: number };
    if (refunds.count > 0) throw new Error("该支出已有退款记录，请先删除关联退款");
    const result = database.prepare(`UPDATE "Transaction" SET "deletedAt"=?, "updatedAt"=? WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`).run(new Date().toISOString(), new Date().toISOString(), id, userId);
    if (result.changes !== 1) throw new Error("消费记录不存在");
  } finally { database.close(); }
}

export function restoreTransaction(userId: string, id: string) {
  const database = openDatabase();
  try {
    const item = database.prepare(`SELECT "originalTransactionId" FROM "Transaction" WHERE "id"=? AND "userId"=? AND "deletedAt" IS NOT NULL`).get(id, userId) as { originalTransactionId: string | null } | undefined;
    if (!item) throw new Error("回收站中没有这条记录");
    if (item.originalTransactionId) {
      const original = database.prepare(`SELECT "id" FROM "Transaction" WHERE "id"=? AND "userId"=? AND "deletedAt" IS NULL`).get(item.originalTransactionId, userId);
      if (!original) throw new Error("请先恢复这笔退款关联的原支出");
    }
    database.prepare(`UPDATE "Transaction" SET "deletedAt"=NULL,"updatedAt"=? WHERE "id"=? AND "userId"=?`).run(new Date().toISOString(), id, userId);
  } finally { database.close(); }
}

export function listDeletedTransactions(userId: string) {
  const database = openDatabase();
  try {
    const rows = database.prepare(`SELECT * FROM "Transaction" WHERE "userId"=? AND "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC LIMIT 100`).all(userId) as unknown as TransactionRow[];
    return rows.map(toRecord);
  } finally { database.close(); }
}
