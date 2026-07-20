import { z } from "zod";

import { transactionCategories, transactionTypes } from "./budget";

export const transactionInputSchema = z.object({
  type: z.enum(transactionTypes),
  amountCents: z.number().int().safe().positive("请输入大于0的金额"),
  category: z.enum(transactionCategories).nullable(),
  itemName: z.string().trim().min(1, "请输入商品或项目名称").max(100),
  merchant: z.string().trim().max(100),
  occurredAt: z.iso.datetime(),
  note: z.string().trim().max(500),
  isFixedExpense: z.boolean(),
  originalTransactionId: z.string().min(1).nullable(),
}).superRefine((input, context) => {
  if (input.type === "INCOME") {
    if (input.category !== null) context.addIssue({ code: "custom", path: ["category"], message: "收入不能选择消费分类" });
    if (input.originalTransactionId !== null) context.addIssue({ code: "custom", path: ["originalTransactionId"], message: "收入不能关联原支出" });
    if (input.isFixedExpense) context.addIssue({ code: "custom", path: ["isFixedExpense"], message: "收入不能标记为固定支出" });
  } else if (input.category === null) {
    context.addIssue({ code: "custom", path: ["category"], message: "支出和退款必须选择分类" });
  }
  if (input.type === "REFUND" && input.originalTransactionId === null) {
    context.addIssue({ code: "custom", path: ["originalTransactionId"], message: "退款必须选择原支出" });
  }
  if (input.type === "EXPENSE" && input.originalTransactionId !== null) {
    context.addIssue({ code: "custom", path: ["originalTransactionId"], message: "普通支出不能关联原支出" });
  }
});

export const transactionQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  category: z.enum(transactionCategories).optional(),
  type: z.enum(transactionTypes).optional(),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
