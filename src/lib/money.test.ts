import { describe, expect, it } from "vitest";

import { centsToYuan, signedCentsToYuan } from "./money";

describe("money formatters", () => {
  it("formats signed cent values without corrupting the fractional part", () => {
    expect(signedCentsToYuan(-1_523)).toBe("-15.23");
    expect(signedCentsToYuan(0)).toBe("0.00");
    expect(signedCentsToYuan(123)).toBe("1.23");
  });

  it("keeps the unsigned formatter strict", () => {
    expect(() => centsToYuan(-1)).toThrow();
  });
});
