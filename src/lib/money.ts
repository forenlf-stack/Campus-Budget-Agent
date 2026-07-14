import { z } from "zod";

const yuanPattern = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

export function yuanToCents(value: string): number {
  const normalized = value.trim();
  if (!yuanPattern.test(normalized)) {
    throw new z.ZodError([{ code: "custom", path: [], message: "金额必须是非负数，且最多保留两位小数" }]);
  }
  const [yuan, fraction = ""] = normalized.split(".");
  const cents = BigInt(yuan) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("金额超出安全范围");
  }
  return result;
}

export function centsToYuan(cents: number): string {
  z.number().int().safe().nonnegative().parse(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
