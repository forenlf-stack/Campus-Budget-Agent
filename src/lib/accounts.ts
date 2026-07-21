import { z } from "zod";

export const accountTypes = ["WECHAT", "ALIPAY", "BANK", "CASH", "OTHER"] as const;
export type AccountType = (typeof accountTypes)[number];

export const accountTypeLabels: Record<AccountType, string> = {
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK: "银行卡",
  CASH: "现金",
  OTHER: "其他账户",
};

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "请输入账户名称").max(50),
  type: z.enum(accountTypes),
  openingBalanceCents: z.number().int().safe(),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const transferInputSchema = z.object({
  fromAccountId: z.string().trim().min(1),
  toAccountId: z.string().trim().min(1),
  amountCents: z.number().int().safe().positive("转账金额必须大于0"),
  occurredAt: z.iso.datetime(),
  note: z.string().trim().max(300).default(""),
}).refine((input) => input.fromAccountId !== input.toAccountId, { path: ["toAccountId"], message: "转入账户不能与转出账户相同" });

export type AccountInput = z.infer<typeof accountInputSchema>;
export type TransferInput = z.infer<typeof transferInputSchema>;
