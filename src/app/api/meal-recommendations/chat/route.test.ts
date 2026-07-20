import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm/deepseek-client", () => ({
  callDeepSeekMessagesJson: vi.fn().mockResolvedValue({
    reply: "如果不想吃面，可以优先考虑鸡腿饭。",
    referencedCandidateIds: ["meal-1", "invented"],
    suggestedRequest: "不要面，想吃饭",
    suggestedQuickTags: [],
    needsNewRecommendation: true,
  }),
}));

import { POST } from "./route";

const recommendation = {
  candidateId: "meal-1", name: "鸡腿饭", merchant: "第一食堂", acquisitionLabel: "东校区", priceCents: 1500,
  recommendationType: "OVERALL", shortTags: ["价格合适"], risk: "暂无明显风险", actionLabel: "选这个",
  details: { totalScore: 8000, scoreBreakdown: { budgetFit: 3000, preferenceMatch: 2000, recentVariety: 1500, historicalRating: 1000, locationConvenience: 500 }, budgetImpact: { remainingBudgetAfterCents: 10000, mealRemainingAfterCents: 5000, recommendedDailyBudgetAfterCents: 1000, savingsTargetStillOnTrack: true }, executionSteps: [] },
};

describe("POST /api/meal-recommendations/chat", () => {
  it("携带历史和候选并过滤模型虚构的候选ID", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "我不想吃面", history: [{ role: "assistant", content: "你更看重什么？" }], recommendations: [recommendation] }) });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "LLM", referencedCandidateIds: ["meal-1"], needsNewRecommendation: true });
  });

  it("拒绝没有当前候选的空会话", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "帮我比较", recommendations: [] }) });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
  });
});
