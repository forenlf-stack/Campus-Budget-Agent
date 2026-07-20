import type { TransactionCategory, TransactionType } from "./budget";

export const transactionGroupSortValues = [
  "AMOUNT_DESC",
  "AMOUNT_ASC",
  "TIME_DESC",
  "TIME_ASC",
  "FIXED_FIRST",
  "MERCHANT_ASC",
] as const;

export type TransactionGroupSort = (typeof transactionGroupSortValues)[number];
export type TransactionGroupKey = TransactionCategory | "INCOME";

export interface GroupableTransaction {
  id: string;
  type: TransactionType;
  category: TransactionCategory | null;
  amountCents: number;
  itemName: string;
  merchant: string | null;
  occurredAt: string;
  isFixedExpense: boolean;
}

export interface TransactionGroup<T extends GroupableTransaction> {
  key: TransactionGroupKey;
  items: T[];
  expenseCents: number;
  refundCents: number;
  incomeCents: number;
  netCents: number;
}

const chineseCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function compareLatestFirst(left: GroupableTransaction, right: GroupableTransaction) {
  return new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
}

export function sortGroupedTransactions<T extends GroupableTransaction>(items: T[], sort: TransactionGroupSort): T[] {
  return [...items].sort((left, right) => {
    if (sort === "AMOUNT_DESC") return right.amountCents - left.amountCents || compareLatestFirst(left, right);
    if (sort === "AMOUNT_ASC") return left.amountCents - right.amountCents || compareLatestFirst(left, right);
    if (sort === "TIME_DESC") return compareLatestFirst(left, right);
    if (sort === "TIME_ASC") return -compareLatestFirst(left, right);
    if (sort === "FIXED_FIRST") return Number(right.isFixedExpense) - Number(left.isFixedExpense) || right.amountCents - left.amountCents || compareLatestFirst(left, right);
    return chineseCollator.compare(left.merchant || "未填写商家", right.merchant || "未填写商家") || right.amountCents - left.amountCents;
  });
}

export function groupTransactions<T extends GroupableTransaction>(transactions: T[], sortByGroup: Partial<Record<TransactionGroupKey, TransactionGroupSort>> = {}): TransactionGroup<T>[] {
  const grouped = new Map<TransactionGroupKey, T[]>();

  for (const transaction of transactions) {
    const key: TransactionGroupKey = transaction.category ?? "INCOME";
    grouped.set(key, [...(grouped.get(key) ?? []), transaction]);
  }

  return [...grouped.entries()]
    .map(([key, items]) => {
      const expenseCents = items.filter((item) => item.type === "EXPENSE").reduce((sum, item) => sum + item.amountCents, 0);
      const refundCents = items.filter((item) => item.type === "REFUND").reduce((sum, item) => sum + item.amountCents, 0);
      const incomeCents = items.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + item.amountCents, 0);
      return {
        key,
        items: sortGroupedTransactions(items, sortByGroup[key] ?? "AMOUNT_DESC"),
        expenseCents,
        refundCents,
        incomeCents,
        netCents: key === "INCOME" ? incomeCents : expenseCents - refundCents,
      };
    })
    .sort((left, right) => {
      if (left.key === "INCOME") return 1;
      if (right.key === "INCOME") return -1;
      return right.netCents - left.netCents || right.items.length - left.items.length;
    });
}
