import { randomUUID } from "node:crypto";

import type { TransactionCategory } from "@/lib/budget";
import { importedTransactionCandidateSchema, type ImportedTransactionCandidate } from "@/lib/transaction-imports";
import type { TransactionRecord } from "@/server/transaction-store";

const categoryTerms: Array<[TransactionCategory, RegExp]> = [
  ["MEAL", /餐|饭|面|粉|米线|小吃|外卖|美团|饿了么|麦当劳|肯德基|食堂|餐厅|烤肉|火锅|麻辣烫|汉堡|烧饼|煎饼|猪脚|吉野家|和合谷/],
  ["SNACK_DRINK", /零食|饮料|奶茶|咖啡|茶饮|便利店|甜品|蛋糕|面包|糕点|蜜雪冰城|味多美/],
  ["DAILY_NECESSITY", /超市|日用品|洗护|纸巾|百货|生活用品|拼多多/],
  ["STUDY", /书|教材|课程|考试|打印|文具|学习|大模型|开放平台|API|Trae/i],
  ["TRANSPORT", /地铁|公交|打车|滴滴|铁路|火车|机票|交通|共享单车/],
  ["GAME_ENTERTAINMENT", /游戏|电影|娱乐|门票|视频|音乐|KTV|Steam|Valve/i],
  ["RECHARGE_SUBSCRIPTION", /充值|会员|订阅|话费|流量/],
  ["MEDICAL", /医院|药|医疗|诊所|挂号|医保|卫生服务站/],
];

export function inferCategory(text: string): TransactionCategory {
  return categoryTerms.find(([, pattern]) => pattern.test(text))?.[0] ?? "OTHER";
}

export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const text = String(value ?? "").trim().replace(/年|月/g, "-").replace(/日/g, "").replace(/\//g, "-");
  if (!text) return null;
  const date = new Date(text.includes("T") || /[+-]\d{2}:?\d{2}|Z$/.test(text) ? text : `${text.replace(/\s+/, "T")}+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeAmountCents(value: unknown): number | null {
  const text = String(value ?? "").replace(/[,，￥¥元\s]/g, "").replace(/^\+/, "");
  const amount = Math.abs(Number(text));
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function detectType(text: string, amountValue?: unknown): "EXPENSE" | "INCOME" | "REFUND" {
  if (/退款|退回|已退|退货/.test(text)) return "REFUND";
  // 微信“群收款”等交易名称虽然包含“收款”，付款人的收支方向仍可能是支出。
  if (/(?:^|\s)支出(?:\s|$)/.test(text)) return "EXPENSE";
  if (/(?:^|\s)收入(?:\s|$)/.test(text)) return "INCOME";
  if (/收入|收款|转入|工资|红包收入|退款到账/.test(text) || String(amountValue ?? "").trim().startsWith("+")) return "INCOME";
  return "EXPENSE";
}

export function markDuplicate(candidate: ImportedTransactionCandidate, existing: TransactionRecord[]) {
  const time = new Date(candidate.occurredAt).getTime();
  const duplicate = existing.find((row) => row.type === candidate.type && row.amountCents === candidate.amountCents && Math.abs(new Date(row.occurredAt).getTime() - time) <= 5 * 60_000 && (row.merchant === candidate.merchant || row.itemName === candidate.itemName));
  return duplicate
    ? { ...candidate, duplicateStatus: "POSSIBLE_DUPLICATE" as const, duplicateReason: "金额、时间和商家/项目与已有记录接近", needsReview: true, reviewReasons: [...new Set([...candidate.reviewReasons, "可能与已有交易重复"])] }
    : candidate;
}

export function candidate(input: Partial<ImportedTransactionCandidate> & Pick<ImportedTransactionCandidate, "source" | "amountCents" | "occurredAt" | "itemName" | "rawReference">): ImportedTransactionCandidate {
  const text = `${input.itemName} ${input.merchant ?? ""} ${input.rawReference}`;
  const category = input.category ?? (input.type === "INCOME" ? null : inferCategory(text));
  const reviewReasons = [...(input.reviewReasons ?? [])];
  if (!input.merchant) reviewReasons.push("商家缺失");
  if (category === "OTHER" && input.type !== "INCOME") reviewReasons.push("分类需要确认");
  return importedTransactionCandidateSchema.parse({
    temporaryId: input.temporaryId ?? randomUUID(),
    type: input.type ?? detectType(text), category, amountCents: input.amountCents, occurredAt: input.occurredAt,
    itemName: input.itemName, merchant: input.merchant ?? "", note: input.note ?? "", isFixedExpense: input.isFixedExpense ?? false,
    originalTransactionId: input.originalTransactionId ?? null,
    source: input.source, confidence: input.confidence ?? 0.8, rawReference: input.rawReference,
    duplicateStatus: input.duplicateStatus ?? "NEW", duplicateReason: input.duplicateReason ?? null,
    needsReview: input.needsReview ?? (reviewReasons.length > 0 || (input.confidence ?? 0.8) < 0.75),
    reviewReasons,
  });
}

export function profileSignals(candidates: ImportedTransactionCandidate[]) {
  const merchants = new Map<string, number>();
  const categories = new Map<TransactionCategory, { count: number; amountCents: number }>();
  const periods = new Map<string, number>();
  for (const item of candidates) {
    if (item.merchant) merchants.set(item.merchant, (merchants.get(item.merchant) ?? 0) + 1);
    if (item.category && item.type !== "INCOME") {
      const current = categories.get(item.category) ?? { count: 0, amountCents: 0 };
      categories.set(item.category, { count: current.count + 1, amountCents: current.amountCents + (item.type === "REFUND" ? -item.amountCents : item.amountCents) });
    }
    const hour = new Date(item.occurredAt).getHours();
    const label = hour < 6 ? "凌晨" : hour < 11 ? "上午" : hour < 14 ? "中午" : hour < 18 ? "下午" : "晚上";
    periods.set(label, (periods.get(label) ?? 0) + 1);
  }
  return {
    frequentMerchants: [...merchants].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([merchant, count]) => ({ merchant, count })),
    frequentCategories: [...categories].sort((a, b) => b[1].amountCents - a[1].amountCents).slice(0, 10).map(([category, value]) => ({ category, ...value, amountCents: Math.max(value.amountCents, 0) })),
    commonSpendingPeriods: [...periods].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
  };
}
