import { describe, expect, it } from "vitest";

import { parseMealRequest } from "./parse-meal-request";

describe("parse_meal_request", () => {
  it("提取价格、口味和距离约束", () => {
    expect(parseMealRequest("想吃清淡的面，15元以内，最好离我近一点")).toMatchObject({
      hardPriceLimitCents: 1_500,
      quickTags: expect.arrayContaining(["LIGHT", "STAY_NEAR"]),
      preferredTerms: expect.arrayContaining(["清淡的面"]),
    });
  });

  it("普通不要会成为软偏好且不会启用想吃辣", () => {
    const result = parseMealRequest("不要辣，想吃米饭");
    expect(result.quickTags).not.toContain("SPICY");
    expect(result.avoidedTerms).toContain("辣");
    expect(result.strictAvoidedTerms).toEqual([]);
    expect(result.preferredTerms).toContain("米饭");
  });

  it("只有明确过敏或不能吃才成为严格避让", () => {
    const result = parseMealRequest("花生过敏，不能吃香菜");
    expect(result.strictAvoidedTerms).toEqual(expect.arrayContaining(["花生", "香菜"]));
  });

  it("数量不会被误识别为价格上限，左右价位作为目标价", () => {
    expect(parseMealRequest("推荐2个包子").hardPriceLimitCents).toBeUndefined();
    expect(parseMealRequest("想吃20元左右的饭").targetPriceCents).toBe(2_000);
  });

  it("识别最近吃过但不常吃的本地历史查询", () => {
    expect(parseMealRequest("算了，我最近吃过但是不常吃的有哪些").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("前段时间偶尔吃过什么？").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("换一批没吃过的").historyQuery).toBeNull();
  });
});
