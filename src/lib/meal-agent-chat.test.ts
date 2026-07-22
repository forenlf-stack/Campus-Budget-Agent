import { describe, expect, it } from "vitest";

import { mealAgentChatInputSchema } from "./meal-agent-chat";

describe("mealAgentChatInputSchema", () => {
  it("允许把上一轮 2000 字以内的用户消息带入历史", () => {
    const content = "测".repeat(2_000);

    expect(() => mealAgentChatInputSchema.parse({
      message: "继续",
      history: [{ role: "user", content }],
      recommendations: [],
    })).not.toThrow();
  });
});
