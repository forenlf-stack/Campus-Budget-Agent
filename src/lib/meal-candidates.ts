import { z } from "zod";

export const mealPeriods = ["BREAKFAST", "LUNCH", "DINNER", "ALL_DAY"] as const;
export const mealCandidateDataSources = ["MANUAL", "SEED"] as const;

export const mealPeriodLabels: Record<(typeof mealPeriods)[number], string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  ALL_DAY: "全天",
};

const listSchema = z.array(z.string().trim().min(1).max(40)).max(30).transform((items) => [...new Set(items)]);

export const mealCandidateInputSchema = z.object({
  name: z.string().trim().min(1, "请输入餐食名称").max(100),
  merchant: z.string().trim().min(1, "请输入商家或档口").max(100),
  typicalPriceCents: z.number().int().safe().positive("典型价格必须大于0"),
  location: z.string().trim().min(1, "请输入地点").max(100),
  mealPeriod: z.enum(mealPeriods),
  tags: listSchema,
  ingredients: listSchema,
  isSpicy: z.boolean(),
  userRating: z.number().int().min(1).max(5).nullable(),
  priceUpdatedAt: z.iso.datetime(),
  enabled: z.boolean(),
});

export const mealCandidateQuerySchema = z.object({
  location: z.string().trim().max(100).optional(),
  mealPeriod: z.enum(mealPeriods).optional(),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

export type MealCandidateInput = z.infer<typeof mealCandidateInputSchema>;
export type MealCandidateQuery = z.infer<typeof mealCandidateQuerySchema>;
export type MealPeriod = (typeof mealPeriods)[number];
export type MealCandidateDataSource = (typeof mealCandidateDataSources)[number];
