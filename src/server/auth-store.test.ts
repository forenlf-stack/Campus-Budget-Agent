import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth-store";

describe("password hashing", () => {
  it("使用带盐 scrypt 验证密码且不会保存明文", async () => {
    const first = await hashPassword("Demo1234");
    const second = await hashPassword("Demo1234");
    expect(first).not.toBe(second);
    expect(first).not.toContain("Demo1234");
    await expect(verifyPassword("Demo1234", first)).resolves.toBe(true);
    await expect(verifyPassword("Wrong1234", first)).resolves.toBe(false);
  });
});
