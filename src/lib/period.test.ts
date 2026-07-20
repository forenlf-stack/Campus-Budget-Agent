import { describe, expect, it } from "vitest";

import { shanghaiPeriodBounds, shanghaiPeriodForDate, shanghaiPeriodStorageDate } from "./period";

describe("上海自然月周期", () => {
  it("按北京时间确定月份", () => {
    expect(shanghaiPeriodForDate(new Date("2026-06-30T16:30:00.000Z"))).toBe("2026-07");
  });

  it("生成对应的UTC查询边界", () => {
    const bounds = shanghaiPeriodBounds("2026-07");
    expect(bounds.start.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-31T16:00:00.000Z");
  });

  it("分类预算仍使用稳定的月份存储键", () => {
    expect(shanghaiPeriodStorageDate("2026-07")).toBe("2026-07-01T00:00:00.000Z");
  });
});
