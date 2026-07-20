import { z } from "zod";

import { transactionCategories } from "@/lib/budget";

export const transactionImportSourceValues = ["TEXT", "IMAGE", "SPREADSHEET"] as const;

export const importedTransactionCandidateSchema = z.object({
  temporaryId: z.string().trim().min(1).max(100),
  type: z.enum(["EXPENSE", "INCOME", "REFUND"]),
  category: z.enum(transactionCategories).nullable(),
  amountCents: z.number().int().safe().positive(),
  occurredAt: z.iso.datetime(),
  itemName: z.string().trim().min(1).max(100),
  merchant: z.string().trim().max(100),
  note: z.string().trim().max(500),
  isFixedExpense: z.boolean(),
  originalTransactionId: z.string().trim().min(1).nullable(),
  source: z.enum(transactionImportSourceValues),
  confidence: z.number().min(0).max(1),
  rawReference: z.string().trim().min(1).max(1000),
  duplicateStatus: z.enum(["NEW", "POSSIBLE_DUPLICATE"]),
  duplicateReason: z.string().trim().max(200).nullable(),
  needsReview: z.boolean(),
  reviewReasons: z.array(z.string().trim().min(1).max(160)).max(10),
}).strict();

export const transactionImportPreviewSchema = z.object({
  importId: z.string().trim().min(1),
  source: z.enum(transactionImportSourceValues),
  candidates: z.array(importedTransactionCandidateSchema).max(1000),
  rejectedCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(20),
  profileSignals: z.object({
    frequentMerchants: z.array(z.object({ merchant: z.string(), count: z.number().int().positive() })).max(10),
    frequentCategories: z.array(z.object({ category: z.enum(transactionCategories), count: z.number().int().positive(), amountCents: z.number().int().nonnegative() })).max(10),
    commonSpendingPeriods: z.array(z.object({ label: z.string(), count: z.number().int().positive() })).max(5),
  }).strict(),
}).strict();

export const transactionImportCommitSchema = z.object({
  importId: z.string().trim().min(1),
  transactions: z.array(importedTransactionCandidateSchema.omit({ duplicateStatus: true, duplicateReason: true, needsReview: true, reviewReasons: true, confidence: true, rawReference: true, source: true })).min(1).max(1000),
}).strict();

export type ImportedTransactionCandidate = z.infer<typeof importedTransactionCandidateSchema>;
export type TransactionImportPreview = z.infer<typeof transactionImportPreviewSchema>;
