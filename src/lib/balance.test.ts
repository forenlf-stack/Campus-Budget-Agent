import { describe, expect, it } from "vitest";

import { calculateCurrentBalanceCents, countAllowanceOccurrences } from "./balance";

describe("全局可用余额", () => {
  it("叠加收入退款并扣除支出后的交易净变化", () => {
    expect(calculateCurrentBalanceCents({
      openingBalanceCents: 350_000,
      balanceAsOf: new Date("2026-07-20T00:00:00.000Z"),
      now: new Date("2026-07-20T12:00:00.000Z"),
      monthlyAllowanceCents: 250_000,
      allowanceDay: 1,
      transactionDeltaCents: -8_000,
    })).toBe(342_000);
  });

  it("每到生活费发放日自动增加一次余额", () => {
    expect(countAllowanceOccurrences(new Date("2026-07-01T00:00:00.000Z"), new Date("2026-09-02T00:00:00.000Z"), 1)).toBe(2);
    expect(calculateCurrentBalanceCents({
      openingBalanceCents: 100_000,
      balanceAsOf: new Date("2026-07-01T00:00:00.000Z"),
      now: new Date("2026-09-02T00:00:00.000Z"),
      monthlyAllowanceCents: 50_000,
      allowanceDay: 1,
      transactionDeltaCents: 0,
    })).toBe(200_000);
  });

  it("发放日在短月份自动使用当月最后一天", () => {
    expect(countAllowanceOccurrences(new Date("2026-02-01T00:00:00.000Z"), new Date("2026-03-01T00:00:00.000Z"), 31)).toBe(1);
  });
});
