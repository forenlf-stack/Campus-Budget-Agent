import { describe, expect, it } from "vitest";

import { isMealPlanAssessmentRequest } from "./route";

describe("meal plan assessment intent", () => {
  it("识别已经给出方案和总价的评价请求", () => {
    expect(isMealPlanAssessmentRequest("你认为一顿麻辣烫怎么样？加了火锅食材和蔬菜豆制品，总共31元")).toBe(true);
  });

  it("普通推荐请求不进入方案评价", () => {
    expect(isMealPlanAssessmentRequest("我想吃麻辣烫，帮我推荐一下")).toBe(false);
  });

  it("识别中文金额的临时餐食评价", () => {
    expect(isMealPlanAssessmentRequest("吃二十元的麦当劳你觉得可以吗")).toBe(true);
  });
});
