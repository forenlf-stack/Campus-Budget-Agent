import { vi } from "vitest";

const demoUser = { id: "user_demo_001", displayName: "测试用户", email: "demo@budget.local" };

vi.mock("@/server/auth", () => ({
  sessionCookieName: "budget_session",
  getCurrentUser: vi.fn(async () => demoUser),
  requireUser: vi.fn(async () => demoUser),
  requireApiUser: vi.fn(async () => demoUser),
}));
