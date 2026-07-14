import { z } from "zod";

export const transactionTypes = ["INCOME", "EXPENSE", "REFUND"] as const;
export const transactionCategories = [
  "MEAL",
  "SNACK_DRINK",
  "DAILY_NECESSITY",
  "STUDY",
  "TRANSPORT",
  "GAME_ENTERTAINMENT",
  "RECHARGE_SUBSCRIPTION",
  "MEDICAL",
  "OTHER",
] as const;

export type TransactionType = (typeof transactionTypes)[number];
export type TransactionCategory = (typeof transactionCategories)[number];
export type BudgetStatus = "HEALTHY" | "WARNING" | "OVER_BUDGET" | "INVALID_PLAN";

export interface BudgetTransaction {
  id: string;
  type: TransactionType;
  category: TransactionCategory | null;
  amountCents: number;
  occurredAt: Date;
  isFixedExpense: boolean;
}

export interface PeriodInput {
  transactions: BudgetTransaction[];
  periodStart: Date;
  periodEnd: Date;
}

export interface FlexibleBudgetInput {
  periodIncomeCents: number;
  plannedFixedExpensesCents: number;
  plannedSavingsCents: number;
  requiredReserveCents: number;
}

export interface RemainingBudgetInput {
  plannedVariableBudgetCents: number;
  actualNetVariableSpendingCents: number;
}

export interface RecommendedDailyBudgetInput {
  remainingBudgetCents: number;
  currentDate: Date;
  periodEnd: Date;
}

export interface RecommendedDailyBudgetResult {
  dailyBudgetCents: number;
  remainingDays: number;
  status: "AVAILABLE" | "NO_REMAINING_BUDGET" | "PERIOD_ENDED";
  rounding: "FLOOR";
}

export interface CategoryBudgetInput {
  category: TransactionCategory;
  budgetCents: number;
}

export interface CategoryUsageInput extends PeriodInput {
  categoryBudgets: CategoryBudgetInput[];
}

export interface CategoryUsage {
  category: TransactionCategory;
  budgetCents: number;
  spentCents: number;
  refundedCents: number;
  netSpendingCents: number;
  remainingCents: number;
  usageBasisPoints: number | null;
}

export interface BudgetStatusInput {
  flexibleBudgetCents: number;
  plannedVariableBudgetCents: number;
  actualNetVariableSpendingCents: number;
  categoryBudgets: CategoryBudgetInput[];
  warningThresholdBasisPoints?: number;
}

const safeIntegerSchema = z.number().int().safe();
const nonNegativeCentsSchema = safeIntegerSchema.nonnegative();
const positiveCentsSchema = safeIntegerSchema.positive();
const dateSchema = z.date().refine((date) => Number.isFinite(date.getTime()), "日期无效");
const categorySchema = z.enum(transactionCategories);

const transactionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(transactionTypes),
  category: categorySchema.nullable(),
  amountCents: positiveCentsSchema,
  occurredAt: dateSchema,
  isFixedExpense: z.boolean(),
}).superRefine((transaction, context) => {
  if (transaction.type === "INCOME" && transaction.category !== null) {
    context.addIssue({ code: "custom", path: ["category"], message: "收入不能设置消费分类" });
  }
  if (transaction.type !== "INCOME" && transaction.category === null) {
    context.addIssue({ code: "custom", path: ["category"], message: "支出和退款必须设置分类" });
  }
});

const periodSchema = z.object({
  transactions: z.array(transactionSchema),
  periodStart: dateSchema,
  periodEnd: dateSchema,
}).refine((input) => input.periodStart < input.periodEnd, {
  path: ["periodEnd"],
  message: "周期结束时间必须晚于开始时间",
});

const categoryBudgetSchema = z.object({
  category: categorySchema,
  budgetCents: nonNegativeCentsSchema,
});

function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("金额计算结果超出安全整数范围");
  }
  return result;
}

function sumCents(values: number[]): number {
  return toSafeNumber(values.reduce((total, value) => total + BigInt(value), BigInt(0)));
}

function subtractCents(minuend: number, subtrahend: number): number {
  return toSafeNumber(BigInt(minuend) - BigInt(subtrahend));
}

function inPeriod(transaction: BudgetTransaction, periodStart: Date, periodEnd: Date): boolean {
  return transaction.occurredAt >= periodStart && transaction.occurredAt < periodEnd;
}

function calculateBasisPoints(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return toSafeNumber((BigInt(numerator) * BigInt(10_000)) / BigInt(denominator));
}

function parseUniqueCategoryBudgets(categoryBudgets: CategoryBudgetInput[]): CategoryBudgetInput[] {
  const parsed = z.array(categoryBudgetSchema).parse(categoryBudgets);
  if (new Set(parsed.map((budget) => budget.category)).size !== parsed.length) {
    throw new z.ZodError([{ code: "custom", path: ["categoryBudgets"], message: "分类预算不能重复" }]);
  }
  return parsed;
}

export function calculatePeriodIncome(input: PeriodInput): number {
  const parsed = periodSchema.parse(input);
  return sumCents(parsed.transactions
    .filter((transaction) => transaction.type === "INCOME" && inPeriod(transaction, parsed.periodStart, parsed.periodEnd))
    .map((transaction) => transaction.amountCents));
}

export function calculateNetVariableSpending(input: PeriodInput): number {
  const parsed = periodSchema.parse(input);
  const periodTransactions = parsed.transactions.filter((transaction) => inPeriod(transaction, parsed.periodStart, parsed.periodEnd));
  const spending = sumCents(periodTransactions
    .filter((transaction) => transaction.type === "EXPENSE" && !transaction.isFixedExpense)
    .map((transaction) => transaction.amountCents));
  const refunds = sumCents(periodTransactions
    .filter((transaction) => transaction.type === "REFUND" && !transaction.isFixedExpense)
    .map((transaction) => transaction.amountCents));
  return Math.max(subtractCents(spending, refunds), 0);
}

export function calculateFlexibleBudget(input: FlexibleBudgetInput): number {
  const parsed = z.object({
    periodIncomeCents: nonNegativeCentsSchema,
    plannedFixedExpensesCents: nonNegativeCentsSchema,
    plannedSavingsCents: nonNegativeCentsSchema,
    requiredReserveCents: nonNegativeCentsSchema,
  }).parse(input);
  const deductions = sumCents([
    parsed.plannedFixedExpensesCents,
    parsed.plannedSavingsCents,
    parsed.requiredReserveCents,
  ]);
  return subtractCents(parsed.periodIncomeCents, deductions);
}

export function calculateRemainingBudget(input: RemainingBudgetInput): number {
  const parsed = z.object({
    plannedVariableBudgetCents: nonNegativeCentsSchema,
    actualNetVariableSpendingCents: nonNegativeCentsSchema,
  }).parse(input);
  return subtractCents(parsed.plannedVariableBudgetCents, parsed.actualNetVariableSpendingCents);
}

export function calculateRecommendedDailyBudget(input: RecommendedDailyBudgetInput): RecommendedDailyBudgetResult {
  const parsed = z.object({
    remainingBudgetCents: safeIntegerSchema,
    currentDate: dateSchema,
    periodEnd: dateSchema,
  }).parse(input);
  const remainingMilliseconds = parsed.periodEnd.getTime() - parsed.currentDate.getTime();
  const remainingDays = remainingMilliseconds > 0 ? Math.ceil(remainingMilliseconds / 86_400_000) : 0;
  if (remainingDays === 0) {
    return { dailyBudgetCents: 0, remainingDays: 0, status: "PERIOD_ENDED", rounding: "FLOOR" };
  }
  if (parsed.remainingBudgetCents <= 0) {
    return { dailyBudgetCents: 0, remainingDays, status: "NO_REMAINING_BUDGET", rounding: "FLOOR" };
  }
  return {
    dailyBudgetCents: Math.floor(parsed.remainingBudgetCents / remainingDays),
    remainingDays,
    status: "AVAILABLE",
    rounding: "FLOOR",
  };
}

export function calculateCategoryUsage(input: CategoryUsageInput): CategoryUsage[] {
  const period = periodSchema.parse(input);
  const categoryBudgets = parseUniqueCategoryBudgets(input.categoryBudgets);
  const periodTransactions = period.transactions.filter((transaction) => inPeriod(transaction, period.periodStart, period.periodEnd));
  return categoryBudgets.map(({ category, budgetCents }) => {
    const matching = periodTransactions.filter((transaction) => transaction.category === category && !transaction.isFixedExpense);
    const spentCents = sumCents(matching.filter((transaction) => transaction.type === "EXPENSE").map((transaction) => transaction.amountCents));
    const refundedCents = sumCents(matching.filter((transaction) => transaction.type === "REFUND").map((transaction) => transaction.amountCents));
    const netSpendingCents = Math.max(subtractCents(spentCents, refundedCents), 0);
    return {
      category,
      budgetCents,
      spentCents,
      refundedCents,
      netSpendingCents,
      remainingCents: subtractCents(budgetCents, netSpendingCents),
      usageBasisPoints: calculateBasisPoints(netSpendingCents, budgetCents),
    };
  });
}

export function calculateBudgetStatus(input: BudgetStatusInput): BudgetStatus {
  const parsed = z.object({
    flexibleBudgetCents: safeIntegerSchema,
    plannedVariableBudgetCents: nonNegativeCentsSchema,
    actualNetVariableSpendingCents: nonNegativeCentsSchema,
    warningThresholdBasisPoints: z.number().int().min(1).max(10_000).default(8_000),
  }).parse(input);
  const categoryBudgets = parseUniqueCategoryBudgets(input.categoryBudgets);
  const categoryBudgetTotal = sumCents(categoryBudgets.map((budget) => budget.budgetCents));
  if (parsed.flexibleBudgetCents < 0 || parsed.plannedVariableBudgetCents > parsed.flexibleBudgetCents || categoryBudgetTotal > parsed.plannedVariableBudgetCents) {
    return "INVALID_PLAN";
  }
  if (parsed.actualNetVariableSpendingCents > parsed.plannedVariableBudgetCents) {
    return "OVER_BUDGET";
  }
  const usage = calculateBasisPoints(parsed.actualNetVariableSpendingCents, parsed.plannedVariableBudgetCents);
  return usage !== null && usage >= parsed.warningThresholdBasisPoints ? "WARNING" : "HEALTHY";
}
