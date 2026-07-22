import { describe, expect, it } from "vitest";

import { mergeMealRequests, parseMealRequest } from "./parse-meal-request";

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

  it("不太想吃辣不会被矛盾地识别为喜欢辣", () => {
    const result = parseMealRequest("今天不太想吃辣，想吃米饭");
    expect(result.quickTags).not.toContain("SPICY");
    expect(result.avoidedTerms).toContain("辣");
    expect(result.preferredTerms).not.toContain("辣");
  });

  it("只有明确过敏或不能吃才成为严格避让", () => {
    const result = parseMealRequest("花生过敏，不能吃香菜");
    expect(result.strictAvoidedTerms).toEqual(expect.arrayContaining(["花生", "香菜"]));
  });

  it("不会把第一人称和介词混入过敏原", () => {
    expect(parseMealRequest("我对花生过敏").strictAvoidedTerms).toEqual(["花生"]);
  });

  it("数量不会被误识别为价格上限，左右价位作为目标价", () => {
    expect(parseMealRequest("推荐2个包子").hardPriceLimitCents).toBeUndefined();
    expect(parseMealRequest("想吃20元左右的饭").targetPriceCents).toBe(2_000);
  });

  it("识别最近吃过但不常吃的本地历史查询", () => {
    expect(parseMealRequest("算了，我最近吃过但是不常吃的有哪些").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("前段时间偶尔吃过什么？").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("最近点过但很少点的有哪些").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("之前偶尔点过什么").historyQuery).toBe("RECENT_INFREQUENT");
    expect(parseMealRequest("换一批没吃过的").historyQuery).toBeNull();
  });

  it("合并模型理解时保留更严格价格并对忌口取安全并集", () => {
    const local = parseMealRequest("15元以内，花生过敏，不太想吃辣，想吃米饭");
    const result = mergeMealRequests(local, {
      quickTags: ["SPICY"], hardPriceLimitCents: 2_500, targetPriceCents: null,
      preferredTerms: ["米饭", "模型虚构菜"], avoidedTerms: [], strictAvoidedTerms: ["peanut", "sesame"],
    }, "15元以内，花生过敏，不太想吃辣，想吃米饭");
    expect(result.hardPriceLimitCents).toBe(1_500);
    expect(result.strictAvoidedTerms).toEqual(["花生"]);
    expect(result.preferredTerms).toContain("米饭");
    expect(result.preferredTerms).not.toContain("模型虚构菜");
    expect(result.quickTags).not.toContain("SPICY");
  });

  it("模型发现更严格且有依据的价格时采用较低上限", () => {
    const result = mergeMealRequests(parseMealRequest("最多20元，最好控制在15元"), {
      quickTags: [], hardPriceLimitCents: 1_500, targetPriceCents: null,
      preferredTerms: [], avoidedTerms: [], strictAvoidedTerms: [],
    }, "最多20元，最好控制在15元");
    expect(result.hardPriceLimitCents).toBe(1_500);
  });
});
