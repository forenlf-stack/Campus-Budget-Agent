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

interface RefundLinkTarget {
  id: string;
  kind: "CANDIDATE" | "EXISTING";
  category: TransactionCategory;
  amountCents: number;
  occurredAt: string;
  itemName: string;
  merchant: string | null;
  isFixedExpense: boolean;
  rawReference: string;
  duplicateStatus?: ImportedTransactionCandidate["duplicateStatus"];
  needsReview?: boolean;
}

function matchText(value: string | null) {
  return String(value ?? "")
    .toLocaleLowerCase("zh-CN")
    .replace(/平台商户|商户|餐厅|退款|微信支付/g, "")
    .replace(/[\s·（）()\-_—]/g, "");
}

function textMatches(left: string | null, right: string | null) {
  const normalizedLeft = matchText(left);
  const normalizedRight = matchText(right);
  return Boolean(normalizedLeft && normalizedRight && (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)));
}

function statusRefundAmountMatches(rawReference: string, amountCents: number) {
  const match = rawReference.match(/退款[^0-9]{0,12}(\d+(?:\.\d{1,2})?)/);
  return Boolean(match && Math.round(Number(match[1]) * 100) === amountCents);
}

function refundLinkScore(refund: ImportedTransactionCandidate, expense: RefundLinkTarget, remainingCents: number) {
  if (remainingCents < refund.amountCents) return Number.NEGATIVE_INFINITY;
  const refundTime = new Date(refund.occurredAt).getTime();
  const expenseTime = new Date(expense.occurredAt).getTime();
  const differenceMs = refundTime - expenseTime;
  if (differenceMs < -5 * 60_000 || differenceMs > 45 * 86_400_000) return Number.NEGATIVE_INFINITY;

  const merchantMatches = textMatches(refund.merchant, expense.merchant);
  const itemMatches = textMatches(refund.itemName, expense.itemName);
  let score = refund.amountCents === expense.amountCents ? 80 : 25;
  if (merchantMatches) score += 55;
  if (itemMatches) score += 30;
  if (refund.category === expense.category) score += 12;
  if (/已全额退款|已退款/.test(expense.rawReference)) score += 15;
  if (statusRefundAmountMatches(expense.rawReference, refund.amountCents)) score += 60;
  if (differenceMs <= 24 * 60 * 60_000) score += 20;
  else if (differenceMs <= 7 * 86_400_000) score += 10;
  if (!merchantMatches && !itemMatches && differenceMs > 6 * 60 * 60_000) score -= 60;
  if (expense.kind === "CANDIDATE" && expense.duplicateStatus === "POSSIBLE_DUPLICATE") score -= 35;
  return score;
}

export function linkRefundCandidates(candidates: ImportedTransactionCandidate[], existing: TransactionRecord[]) {
  const existingRefunded = new Map<string, number>();
  for (const transaction of existing) {
    if (transaction.type === "REFUND" && transaction.originalTransactionId) {
      existingRefunded.set(transaction.originalTransactionId, (existingRefunded.get(transaction.originalTransactionId) ?? 0) + transaction.amountCents);
    }
  }

  const candidateRemaining = new Map<string, number>();
  const existingRemaining = new Map<string, number>();
  const candidateExpenses: RefundLinkTarget[] = candidates
    .filter((item): item is ImportedTransactionCandidate & { category: TransactionCategory } => item.type === "EXPENSE" && item.category !== null)
    .map((item) => {
      candidateRemaining.set(item.temporaryId, item.amountCents);
      return { id: item.temporaryId, kind: "CANDIDATE", category: item.category, amountCents: item.amountCents, occurredAt: item.occurredAt, itemName: item.itemName, merchant: item.merchant, isFixedExpense: item.isFixedExpense, rawReference: item.rawReference, duplicateStatus: item.duplicateStatus, needsReview: item.needsReview };
    });
  const existingExpenses: RefundLinkTarget[] = existing
    .filter((item): item is TransactionRecord & { category: TransactionCategory } => item.type === "EXPENSE" && item.category !== null)
    .map((item) => {
      existingRemaining.set(item.id, Math.max(item.amountCents - (existingRefunded.get(item.id) ?? 0), 0));
      return { id: item.id, kind: "EXISTING", category: item.category, amountCents: item.amountCents, occurredAt: item.occurredAt, itemName: item.itemName, merchant: item.merchant, isFixedExpense: item.isFixedExpense, rawReference: "" };
    });
  const targets = [...candidateExpenses, ...existingExpenses];
  const linked = new Map<string, ImportedTransactionCandidate>();

  for (const refund of candidates.filter((item) => item.type === "REFUND").sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())) {
    if (refund.originalTransactionId || refund.originalCandidateTemporaryId) continue;
    const scored = targets
      .map((target) => ({ target, score: refundLinkScore(refund, target, target.kind === "CANDIDATE" ? candidateRemaining.get(target.id) ?? 0 : existingRemaining.get(target.id) ?? 0) }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score >= 70)
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const ambiguous = best && scored[1] && best.score - scored[1].score < 12;
    if (!best || ambiguous) {
      const reason = ambiguous ? "找到多个相近的原支出，需要确认退款关联" : "未找到可信的原支出，需要确认退款关联";
      linked.set(refund.temporaryId, { ...refund, needsReview: true, reviewReasons: [...new Set([...refund.reviewReasons, reason])] });
      continue;
    }

    const remaining = best.target.kind === "CANDIDATE" ? candidateRemaining : existingRemaining;
    remaining.set(best.target.id, (remaining.get(best.target.id) ?? 0) - refund.amountCents);
    const reviewReasons = refund.reviewReasons.filter((reason) => reason !== "分类需要确认");
    if (best.target.needsReview) reviewReasons.push("关联的原支出仍需复核");
    linked.set(refund.temporaryId, {
      ...refund,
      category: best.target.category,
      isFixedExpense: best.target.isFixedExpense,
      originalTransactionId: best.target.kind === "EXISTING" ? best.target.id : null,
      originalCandidateTemporaryId: best.target.kind === "CANDIDATE" ? best.target.id : null,
      needsReview: refund.duplicateStatus === "POSSIBLE_DUPLICATE" || reviewReasons.length > 0,
      reviewReasons,
    });
  }

  return candidates.map((item) => linked.get(item.temporaryId) ?? item);
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
    itemName: input.itemName, merchant: input.merchant ?? "", rawItemName: input.rawItemName ?? input.itemName, rawMerchant: input.rawMerchant ?? input.merchant ?? "", note: input.note ?? "", isFixedExpense: input.isFixedExpense ?? false,
    originalTransactionId: input.originalTransactionId ?? null,
    originalCandidateTemporaryId: input.originalCandidateTemporaryId ?? null,
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
