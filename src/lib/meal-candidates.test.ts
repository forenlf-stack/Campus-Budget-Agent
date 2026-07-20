import { describe, expect, it } from "vitest";

import { mealCandidateInputSchema, mealCandidateQuerySchema } from "./meal-candidates";

const validCandidate = {
  name: "鸡腿饭",
  merchant: "第一食堂",
  typicalPriceCents: 1500,
  location: "东校区",
  mealPeriod: "LUNCH" as const,
  tags: ["米饭套餐", "高蛋白"],
  ingredients: ["大米", "鸡肉"],
  isSpicy: false,
  userRating: 5,
  priceUpdatedAt: "2026-07-15T07:00:00.000Z",
  enabled: true,
};

describe("餐食候选校验", () => {
  it("接受有效候选并去重列表", () => {
    const result = mealCandidateInputSchema.parse({ ...validCandidate, tags: ["米饭套餐", "米饭套餐"] });
    expect(result.tags).toEqual(["米饭套餐"]);
  });

  it("拒绝零、负数和小数分价格", () => {
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, typicalPriceCents: 0 }).success).toBe(false);
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, typicalPriceCents: -100 }).success).toBe(false);
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, typicalPriceCents: 12.5 }).success).toBe(false);
  });

  it("评分只允许1至5或空", () => {
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, userRating: null }).success).toBe(true);
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, userRating: 0 }).success).toBe(false);
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, userRating: 6 }).success).toBe(false);
  });

  it("拒绝不稳定时段代码", () => {
    expect(mealCandidateInputSchema.safeParse({ ...validCandidate, mealPeriod: "BRUNCH" }).success).toBe(false);
  });

  it("解析地点、时段和状态筛选", () => {
    expect(mealCandidateQuerySchema.parse({ location: "东校区", mealPeriod: "LUNCH", enabled: "false" })).toEqual({ location: "东校区", mealPeriod: "LUNCH", enabled: false });
  });

  it("状态筛选将字符串true和false转换为布尔值", () => {
    expect(mealCandidateQuerySchema.parse({ enabled: "true" }).enabled).toBe(true);
    expect(mealCandidateQuerySchema.parse({ enabled: "false" }).enabled).toBe(false);
  });
});
