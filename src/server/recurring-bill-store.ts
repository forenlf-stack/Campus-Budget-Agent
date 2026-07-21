import { randomUUID } from "node:crypto";

import { recurringBillInputSchema, type RecurrenceFrequency, type RecurringBillInput } from "@/lib/recurring-bills";
import { openDatabase } from "@/server/database";

function advanceDueDate(iso: string, frequency: RecurrenceFrequency) {
  const date = new Date(iso);
  if (frequency === "WEEKLY") date.setUTCDate(date.getUTCDate() + 7);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    if (frequency === "MONTHLY") date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString();
}

function validateAccount(database: ReturnType<typeof openDatabase>, userId: string, accountId?: string | null) {
  if (!accountId) return;
  if (!database.prepare(`SELECT "id" FROM "Account" WHERE "id"=? AND "userId"=? AND "enabled"=1`).get(accountId, userId)) throw new Error("周期账单账户不存在或已停用");
}

export function listRecurringBills(userId: string) {
  const database = openDatabase();
  try {
    const rows = database.prepare(`SELECT bill.*, account."name" AS "accountName" FROM "RecurringBill" bill LEFT JOIN "Account" account ON account."id"=bill."accountId" WHERE bill."userId"=? ORDER BY bill."enabled" DESC,bill."nextDueAt" ASC`).all(userId) as Array<Record<string, string | number | null>>;
    const now = Date.now();
    return rows.map((row) => {
      const daysUntilDue = Math.ceil((new Date(String(row.nextDueAt)).getTime() - now) / 86_400_000);
      return { ...row, daysUntilDue, reminderDue: daysUntilDue <= Number(row.reminderDays) };
    });
  } finally { database.close(); }
}

export function createRecurringBill(userId: string, input: RecurringBillInput) {
  const data = recurringBillInputSchema.parse(input);
  const database = openDatabase();
  try {
    validateAccount(database, userId, data.accountId);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO "RecurringBill" ("id","userId","name","type","category","amountCents","itemName","merchant","accountId","note","isFixedExpense","frequency","nextDueAt","reminderDays","enabled","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, data.name, data.type, data.category, data.amountCents, data.itemName, data.merchant || null, data.accountId ?? null, data.note || null, data.isFixedExpense ? 1 : 0, data.frequency, data.nextDueAt, data.reminderDays, data.enabled ? 1 : 0, now, now);
    return id;
  } finally { database.close(); }
}

export function deleteRecurringBill(userId: string, id: string) {
  const database = openDatabase();
  try {
    const result = database.prepare(`DELETE FROM "RecurringBill" WHERE "id"=? AND "userId"=?`).run(id, userId);
    if (result.changes !== 1) throw new Error("周期账单不存在");
  } finally { database.close(); }
}

export function generateDueRecurringBills(userId: string, now = new Date()) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const bills = database.prepare(`SELECT * FROM "RecurringBill" WHERE "userId"=? AND "enabled"=1 AND "nextDueAt"<=? ORDER BY "nextDueAt" ASC`).all(userId, now.toISOString()) as Array<Record<string, string | number | null>>;
    const transactionIds: string[] = [];
    for (const bill of bills) {
      let nextDueAt = String(bill.nextDueAt);
      let generated = 0;
      while (new Date(nextDueAt) <= now && generated < 24) {
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        database.prepare(`INSERT INTO "Transaction" ("id","userId","type","category","source","amountCents","occurredAt","itemName","merchant","note","isFixedExpense","originalTransactionId","accountId","createdAt","updatedAt") VALUES (?,?,?,?, 'MANUAL',?,?,?,?,?,?,NULL,?,?,?)`)
          .run(id, userId, bill.type, bill.category, bill.amountCents, nextDueAt, bill.itemName, bill.merchant, bill.note, bill.isFixedExpense, bill.accountId, timestamp, timestamp);
        transactionIds.push(id);
        nextDueAt = advanceDueDate(nextDueAt, String(bill.frequency) as RecurrenceFrequency);
        generated += 1;
      }
      database.prepare(`UPDATE "RecurringBill" SET "nextDueAt"=?,"lastGeneratedAt"=?,"updatedAt"=? WHERE "id"=?`).run(nextDueAt, now.toISOString(), now.toISOString(), bill.id);
    }
    database.exec("COMMIT");
    return { count: transactionIds.length, transactionIds };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* no-op */ }
    throw error;
  } finally { database.close(); }
}
