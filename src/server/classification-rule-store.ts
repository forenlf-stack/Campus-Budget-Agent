import { randomUUID } from "node:crypto";

import type { TransactionCategory } from "@/lib/budget";
import { merchantRuleKey } from "@/lib/merchant-normalization";
import type { ImportedTransactionCandidate } from "@/lib/transaction-imports";
import { openDatabase } from "@/server/database";

export interface ClassificationRuleRecord {
  id: string;
  merchantPattern: string;
  itemPattern: string | null;
  normalizedMerchant: string;
  category: TransactionCategory;
  priority: number;
  enabled: number | boolean;
}

export function listClassificationRules(userId: string) {
  const database = openDatabase();
  try {
    const rows = database.prepare(`SELECT "id","merchantPattern","itemPattern","normalizedMerchant","category","priority","enabled" FROM "ClassificationRule" WHERE "userId"=? ORDER BY "enabled" DESC,"priority" DESC,"updatedAt" DESC`).all(userId) as unknown as ClassificationRuleRecord[];
    return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  } finally { database.close(); }
}

export function rememberClassificationRule(userId: string, input: { merchant: string; itemName?: string | null; normalizedMerchant: string; category: TransactionCategory }) {
  const merchantPattern = merchantRuleKey(input.merchant);
  if (!merchantPattern) return null;
  const itemPattern = input.itemName ? merchantRuleKey(input.itemName) : "";
  const database = openDatabase();
  try {
    const now = new Date().toISOString();
    const existing = database.prepare(`SELECT "id" FROM "ClassificationRule" WHERE "userId"=? AND "merchantPattern"=? AND "itemPattern"=?`).get(userId, merchantPattern, itemPattern) as { id: string } | undefined;
    if (existing) {
      database.prepare(`UPDATE "ClassificationRule" SET "normalizedMerchant"=?,"category"=?,"priority"=100,"enabled"=1,"updatedAt"=? WHERE "id"=?`).run(input.normalizedMerchant, input.category, now, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    database.prepare(`INSERT INTO "ClassificationRule" ("id","userId","merchantPattern","itemPattern","normalizedMerchant","category","priority","enabled","createdAt","updatedAt") VALUES (?,?,?,?,?,?,100,1,?,?)`)
      .run(id, userId, merchantPattern, itemPattern, input.normalizedMerchant, input.category, now, now);
    return id;
  } finally { database.close(); }
}

export function applyClassificationRules(candidates: ImportedTransactionCandidate[], rules: ClassificationRuleRecord[]) {
  return candidates.map((candidate) => {
    if (candidate.type === "INCOME") return candidate;
    const merchantKey = merchantRuleKey(candidate.merchant || candidate.rawMerchant);
    const itemKey = merchantRuleKey(candidate.itemName || candidate.rawItemName);
    const rule = rules.find((entry) => Boolean(entry.enabled) && merchantKey.includes(entry.merchantPattern) && (!entry.itemPattern || itemKey.includes(entry.itemPattern)));
    if (!rule) return candidate;
    const reviewReasons = candidate.reviewReasons.filter((reason) => reason !== "分类需要确认");
    return { ...candidate, merchant: rule.normalizedMerchant || candidate.merchant, category: rule.category, reviewReasons, needsReview: candidate.duplicateStatus === "POSSIBLE_DUPLICATE" || reviewReasons.length > 0 };
  });
}

export function deleteClassificationRule(userId: string, id: string) {
  const database = openDatabase();
  try { database.prepare(`DELETE FROM "ClassificationRule" WHERE "id"=? AND "userId"=?`).run(id, userId); }
  finally { database.close(); }
}
