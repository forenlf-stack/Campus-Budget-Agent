import { randomUUID } from "node:crypto";

import { accountInputSchema, transferInputSchema, type AccountInput, type TransferInput } from "@/lib/accounts";
import { openDatabase } from "@/server/database";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  openingBalanceCents: number;
  isDefault: number;
  enabled: number;
  balanceCents: number;
}

function accountRecord(row: AccountRow) {
  return { ...row, isDefault: Boolean(row.isDefault), enabled: Boolean(row.enabled) };
}

export function listAccounts(userId: string) {
  const database = openDatabase();
  try {
    const rows = database.prepare(`
      SELECT account.*,
        account."openingBalanceCents"
        + COALESCE((SELECT SUM(CASE WHEN tx."type" IN ('INCOME','REFUND') THEN tx."amountCents" ELSE -tx."amountCents" END) FROM "Transaction" tx WHERE tx."accountId" = account."id" AND tx."deletedAt" IS NULL), 0)
        + COALESCE((SELECT SUM(transfer."amountCents") FROM "AccountTransfer" transfer WHERE transfer."toAccountId" = account."id" AND transfer."deletedAt" IS NULL), 0)
        - COALESCE((SELECT SUM(transfer."amountCents") FROM "AccountTransfer" transfer WHERE transfer."fromAccountId" = account."id" AND transfer."deletedAt" IS NULL), 0)
        AS "balanceCents"
      FROM "Account" account WHERE account."userId" = ?
      ORDER BY account."enabled" DESC, account."isDefault" DESC, account."createdAt" ASC
    `).all(userId) as unknown as AccountRow[];
    return rows.map(accountRecord);
  } finally { database.close(); }
}

export function createAccount(userId: string, input: AccountInput) {
  const data = accountInputSchema.parse(input);
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    if (data.isDefault) database.prepare(`UPDATE "Account" SET "isDefault" = 0 WHERE "userId" = ?`).run(userId);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO "Account" ("id","userId","name","type","openingBalanceCents","isDefault","enabled","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, data.name, data.type, data.openingBalanceCents, data.isDefault ? 1 : 0, data.enabled ? 1 : 0, now, now);
    database.exec("COMMIT");
    return id;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* no-op */ }
    throw error;
  } finally { database.close(); }
}

export function updateAccount(userId: string, id: string, input: AccountInput) {
  const data = accountInputSchema.parse(input);
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    const existing = database.prepare(`SELECT "id" FROM "Account" WHERE "id" = ? AND "userId" = ?`).get(id, userId);
    if (!existing) throw new Error("账户不存在");
    if (data.isDefault) database.prepare(`UPDATE "Account" SET "isDefault" = 0 WHERE "userId" = ?`).run(userId);
    database.prepare(`UPDATE "Account" SET "name"=?,"type"=?,"openingBalanceCents"=?,"isDefault"=?,"enabled"=?,"updatedAt"=? WHERE "id"=? AND "userId"=?`)
      .run(data.name, data.type, data.openingBalanceCents, data.isDefault ? 1 : 0, data.enabled ? 1 : 0, new Date().toISOString(), id, userId);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* no-op */ }
    throw error;
  } finally { database.close(); }
}

function validateTransferAccounts(database: ReturnType<typeof openDatabase>, userId: string, input: TransferInput) {
  const accounts = database.prepare(`SELECT "id" FROM "Account" WHERE "userId" = ? AND "enabled" = 1 AND "id" IN (?,?)`).all(userId, input.fromAccountId, input.toAccountId) as Array<{ id: string }>;
  if (accounts.length !== 2) throw new Error("转账账户不存在或已停用");
}

export function createTransfer(userId: string, input: TransferInput) {
  const data = transferInputSchema.parse(input);
  const database = openDatabase();
  try {
    validateTransferAccounts(database, userId, data);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO "AccountTransfer" ("id","userId","fromAccountId","toAccountId","amountCents","occurredAt","note","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, data.fromAccountId, data.toAccountId, data.amountCents, data.occurredAt, data.note || null, now, now);
    return id;
  } finally { database.close(); }
}

export function listTransfers(userId: string, period?: string) {
  const database = openDatabase();
  try {
    const parameters: string[] = [userId];
    let periodFilter = "";
    if (period) {
      const [year, month] = period.split("-").map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1) - 8 * 60 * 60_000).toISOString();
      const end = new Date(Date.UTC(year, month, 1) - 8 * 60 * 60_000).toISOString();
      periodFilter = ` AND transfer."occurredAt" >= ? AND transfer."occurredAt" < ?`;
      parameters.push(start, end);
    }
    return database.prepare(`
      SELECT transfer.*, source."name" AS "fromAccountName", target."name" AS "toAccountName"
      FROM "AccountTransfer" transfer
      JOIN "Account" source ON source."id" = transfer."fromAccountId"
      JOIN "Account" target ON target."id" = transfer."toAccountId"
      WHERE transfer."userId" = ? AND transfer."deletedAt" IS NULL${periodFilter}
      ORDER BY transfer."occurredAt" DESC, transfer."createdAt" DESC
    `).all(...parameters);
  } finally { database.close(); }
}

export function setTransferDeleted(userId: string, id: string, deleted: boolean) {
  const database = openDatabase();
  try {
    const result = database.prepare(`UPDATE "AccountTransfer" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "userId" = ?`)
      .run(deleted ? new Date().toISOString() : null, new Date().toISOString(), id, userId);
    if (result.changes !== 1) throw new Error("转账记录不存在");
  } finally { database.close(); }
}
