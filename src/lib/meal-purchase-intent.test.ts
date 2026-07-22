import { describe, expect, it } from "vitest";

import { parseCompletedMealPurchase } from "./meal-purchase-intent";

describe("parseCompletedMealPurchase", () => {
  it.each([
    ["我买了一份35元的玛格丽特，尝试一下", { itemName: "玛格丽特", actualPriceCents: 3_500 }],
    ["刚点了牛肉饭，18块", { itemName: "牛肉饭", actualPriceCents: 1_800 }],
    ["已经吃了二十五元的寿司", { itemName: "寿司", actualPriceCents: 2_500 }],
    ["我买了一碗拉面", { itemName: "拉面", actualPriceCents: null }],
  ])("识别已发生的购买：%s", (message, expected) => {
    expect(parseCompletedMealPurchase(message)).toEqual(expected);
  });

  it.each(["我想买一份寿司", "我还没买拉面", "算了不买了", "准备点一份牛肉饭"])("不把未发生的意图当成购买：%s", (message) => {
    expect(parseCompletedMealPurchase(message)).toBeNull();
  });
});
