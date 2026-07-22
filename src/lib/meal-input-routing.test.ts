import { describe, expect, it } from "vitest";

import { classifyMealInput, normalizeMealConversation, parseMentionedPriceCents } from "./meal-input-routing";

describe("meal input routing", () => {
  it.each([
    ["预算30元，建议吃什么", "DIRECT_RECOMMENDATION"],
    ["推荐20元的饭", "DIRECT_RECOMMENDATION"],
    ["帮我推荐一顿15元以内的清淡午餐", "DIRECT_RECOMMENDATION"],
    ["25元以内想吃咖喱，不想走远，推荐", "DIRECT_RECOMMENDATION"],
    ["想吃清淡的面，不要辣，20元以内", "DIRECT_RECOMMENDATION"],
    ["30元的鳗鱼牛肉饭合适吗", "ASSESSMENT"],
    ["￥30的鳗鱼饭合适吗", "ASSESSMENT"],
    ["31块5的麻辣烫值不值", "ASSESSMENT"],
    ["30元合适吗", "CHAT"],
    ["最近点过但很少点的有哪些", "CHAT"],
    ["算了，我最近吃过但是不常吃的有哪些", "CHAT"],
  ] as const)("routes %s", (input, expected) => {
    expect(classifyMealInput(input)).toBe(expected);
  });

  it.each([
    ["￥30的鳗鱼饭", 3_000],
    ["31块5的麻辣烫", 3_150],
    ["三十一块五的面", 3_150],
    ["三十元的饭", 3_000],
    ["二十元零五角", 2_050],
  ] as const)("parses price in %s", (input, expected) => {
    expect(parseMentionedPriceCents(input)).toBe(expected);
  });

  it("truncates every stored history message to the API history limit", () => {
    const conversation = normalizeMealConversation([{ role: "user", content: "问".repeat(2_100) }]);
    expect(conversation[0].content).toHaveLength(2_000);
  });
});
