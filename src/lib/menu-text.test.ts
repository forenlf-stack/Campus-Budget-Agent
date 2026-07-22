import { describe, expect, it } from "vitest";

import { parseMenuText } from "./menu-text";

describe("parseMenuText", () => {
  it.each([
    ["鸡腿饭 ¥15", "鸡腿饭", 1_500],
    ["鸡腿饭 ￥15", "鸡腿饭", 1_500],
    ["鸡腿饭 15元", "鸡腿饭", 1_500],
    ["鸡腿饭 15块", "鸡腿饭", 1_500],
    ["¥15 鸡腿饭", "鸡腿饭", 1_500],
    ["鸡腿饭 15", "鸡腿饭", 1_500],
  ] as const)("parses %s", (line, name, priceCents) => {
    expect(parseMenuText(line)[0]).toMatchObject({ name, priceCents, needsConfirmation: false });
  });

  it("does not treat a number embedded in a dish name as a bare price", () => {
    expect(parseMenuText("双人2号套餐")).toEqual([]);
  });

  it("keeps a multi-price line for confirmation instead of guessing", () => {
    expect(parseMenuText("鸡腿饭 15元/大份20元")[0]).toMatchObject({ priceCents: null, needsConfirmation: true });
  });
});
