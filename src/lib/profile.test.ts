import { describe, expect, it } from "vitest";

import { accountProfileInputSchema, passwordChangeInputSchema } from "@/lib/profile";

describe("account profile validation", () => {
  it("normalizes an email and accepts an unverified phone number", () => {
    const value = accountProfileInputSchema.parse({ displayName: "小明", email: " USER@Example.COM ", phone: "+86 138-0000-0000" });
    expect(value).toEqual({ displayName: "小明", email: "user@example.com", phone: "+86 138-0000-0000" });
  });

  it("allows the phone number to remain empty", () => {
    expect(accountProfileInputSchema.parse({ displayName: "小明", email: "user@example.com", phone: "" }).phone).toBe("");
  });

  it("rejects unexpected phone text", () => {
    expect(() => accountProfileInputSchema.parse({ displayName: "小明", email: "user@example.com", phone: "call me" })).toThrow();
  });
});

describe("password change validation", () => {
  it("requires matching new passwords with letters and numbers", () => {
    expect(passwordChangeInputSchema.safeParse({ currentPassword: "Old12345", newPassword: "Next12345", confirmPassword: "Next12345" }).success).toBe(true);
    expect(passwordChangeInputSchema.safeParse({ currentPassword: "Old12345", newPassword: "Next12345", confirmPassword: "Other12345" }).success).toBe(false);
    expect(passwordChangeInputSchema.safeParse({ currentPassword: "Old12345", newPassword: "12345678", confirmPassword: "12345678" }).success).toBe(false);
  });
});
