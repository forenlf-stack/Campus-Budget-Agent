import { randomUUID } from "node:crypto";

import type { TransactionImportPreview } from "@/lib/transaction-imports";

const previews = new Map<string, { userId: string; preview: TransactionImportPreview; expiresAt: number }>();
const ttlMs = 30 * 60_000;

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of previews) if (entry.expiresAt <= now) previews.delete(id);
}

export function saveImportPreview(userId: string, preview: Omit<TransactionImportPreview, "importId">) {
  cleanup();
  const importId = randomUUID();
  const stored = { ...preview, importId };
  previews.set(importId, { userId, preview: stored, expiresAt: Date.now() + ttlMs });
  return stored;
}

export function readImportPreview(userId: string, importId: string) {
  cleanup();
  const entry = previews.get(importId);
  return entry?.userId === userId ? entry.preview : null;
}

export function deleteImportPreview(userId: string, importId: string) {
  const entry = previews.get(importId);
  if (entry?.userId === userId) previews.delete(importId);
}
