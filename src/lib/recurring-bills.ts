import { z } from "zod";

import { transactionCategories } from "./budget";

export const recurrenceFrequencies = ["WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

export const recurringBillInputSchema = z.object({
  name: z.string().trim().min(1, "请输入周期账单名称").max(80),
  type: z.enum(["INCOME", "EXPENSE"]),
  category: z.enum(transactionCategories).nullable(),
  amountCents: z.number().int().safe().positive(),
  itemName: z.string().trim().min(1).max(100),
  merchant: z.string().trim().max(100),
  accountId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(500),
  isFixedExpense: z.boolean().default(true),
  frequency: z.enum(recurrenceFrequencies),
  nextDueAt: z.iso.datetime(),
  reminderDays: z.number().int().min(0).max(30).default(3),
  enabled: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.type === "INCOME" && input.category !== null) context.addIssue({ code: "custom", path: ["category"], message: "周期收入不能选择消费分类" });
  if (input.type === "EXPENSE" && input.category === null) context.addIssue({ code: "custom", path: ["category"], message: "周期支出必须选择分类" });
});

export type RecurringBillInput = z.infer<typeof recurringBillInputSchema>;
