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

  it("不要辣会成为临时严格避让且不会启用想吃辣", () => {
    const result = parseMealRequest("不要辣，想吃米饭");
    expect(result.quickTags).not.toContain("SPICY");
    expect(result.avoidedTerms).toContain("辣");
    expect(result.preferredTerms).toContain("米饭");
  });
});
