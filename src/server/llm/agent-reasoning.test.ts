import { describe, expect, it } from "vitest";

import { interpretedMealRequestSchema } from "./agent-reasoning";

const complete = {
  quickTags: [], hardPriceLimitCents: null, targetPriceCents: null,
  preferredTerms: [], avoidedTerms: [], strictAvoidedTerms: [],
  understanding: "理解用户需求", response: "将结合本地信息推荐",
};

describe("interpreted meal request schema", () => {
  it("接受字段完整且类型准确的模型 JSON", () => {
    expect(interpretedMealRequestSchema.parse(complete)).toEqual(complete);
  });

  it("关键字段缺失、错误字段名和字符串金额均不得静默默认", () => {
    const missing: Record<string, unknown> = { ...complete };
    delete missing.hardPriceLimitCents;
    expect(interpretedMealRequestSchema.safeParse(missing).success).toBe(false);
    expect(interpretedMealRequestSchema.safeParse({ ...complete, hard_price_limit_cents: 1500 }).success).toBe(false);
    expect(interpretedMealRequestSchema.safeParse({ ...complete, hardPriceLimitCents: "1500" }).success).toBe(false);
  });
});
