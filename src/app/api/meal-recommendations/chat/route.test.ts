import { describe, expect, it, vi } from "vitest";

const { callDeepSeekJson, callDeepSeekMessagesJson } = vi.hoisted(() => ({
  callDeepSeekJson: vi.fn(async (_system: string, user: string) => {
    const facts = JSON.parse(user) as {
      subject: string;
      configuredRecommendedMealPriceYuan: string;
      configuredAcceptableUpperLimitYuan: string;
      recentWindowDays: number;
      recentNetAverageYuan: string;
    };
    return {
      reply: `${facts.subject}今天可以优先参考¥${facts.configuredRecommendedMealPriceYuan}的建议餐价，¥${facts.configuredAcceptableUpperLimitYuan}是可接受上限。你近${facts.recentWindowDays}天的实际净均价是¥${facts.recentNetAverageYuan}，这反映过去花费偏高，不等于今天也应照此消费；当前没有可直接比较的${facts.subject}候选。`,
    };
  }),
  callDeepSeekMessagesJson: vi.fn().mockResolvedValue({
    reply: "如果不想吃面，可以优先考虑鸡腿饭。",
    referencedCandidateIds: ["meal-1", "invented"],
    suggestedRequest: "不要面，想吃饭",
    suggestedQuickTags: [],
    needsNewRecommendation: true,
  }),
}));

vi.mock("@/server/llm/deepseek-client", () => ({
  callDeepSeekJson,
  callDeepSeekMessagesJson,
}));

vi.mock("@/server/skills/retrieve-historical-meal-patterns", () => ({
  retrieveHistoricalMealPatterns: vi.fn().mockReturnValue({
    success: true,
    data: {
      recentDays: 30,
      lookbackDays: 90,
      consideredMealCount: 12,
      insufficientHistory: false,
      patterns: [{
        name: "咖喱鸡肉饭",
        merchant: "中心美食广场",
        occurrenceCount: 1,
        averageNetAmountCents: 1_850,
        lastOccurredAt: new Date("2026-07-18T12:00:00+08:00"),
      }],
    },
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

  it("第三轮历史低频查询直接返回本地流水内容，不依赖当前候选", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "算了，我最近吃过但是不常吃的有哪些",
        history: [
          { role: "user", content: "我想吃一些咖喱，给我一些价格建议" },
          { role: "assistant", content: "单顿咖喱饭建议控制在15元左右。" },
          { role: "user", content: "30元的鳗鱼牛肉饭合适吗" },
          { role: "assistant", content: "建议再想想。" },
        ],
        recommendations: [],
      }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "RULES", needsNewRecommendation: false, referencedCandidateIds: [] });
    expect(payload.reply).toContain("咖喱鸡肉饭");
    expect(payload.reply).toContain("本地");
    expect(payload.reply).not.toContain("我可以直接评价");
  });

  it("历史低频列表的后续晚餐追问会延续本地上下文并给出明确选择", async () => {
    callDeepSeekJson.mockRejectedValueOnce(new Error("temporary failure"));
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "你认为我吃哪个当晚饭最好",
        history: [
          { role: "user", content: "我最近吃过但是不常吃的有哪些" },
          { role: "assistant", content: "按你的本地账本统计，咖喱鸡肉饭最近吃过1次。" },
        ],
        recommendations: [],
      }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "RULES", needsNewRecommendation: false, referencedCandidateIds: [] });
    expect(payload.reply).toContain("我更推荐咖喱鸡肉饭");
    expect(payload.reply).toContain("晚餐");
    expect(payload.reply).toContain("无法可靠判断");
    expect(payload.reply).not.toContain("我可以直接评价");
  });

  it("询问具体餐食价格时直接回答价格区间，不触发无关候选重算", async () => {
    const request = new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "我想吃一些咖喱，给我一些价格建议",
        recommendations: [recommendation],
      }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "LLM", needsNewRecommendation: false, suggestedRequest: null });
    expect(payload.reply).toContain("咖喱");
    expect(payload.reply).toContain("没有可直接比较的咖喱候选");
    expect(payload.reply).not.toContain("重新计算");
  });

  it.each(["日料", "烧烤", "轻食"])("价格建议可泛化到%s而不是依赖咖喱特例", async (subject) => {
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `我想尝试一些${subject}，给我价格建议`, recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ source: "LLM", needsNewRecommendation: false });
    expect(payload.reply).toContain(subject);
    expect(payload.reply).toContain(`没有可直接比较的${subject}候选`);
  });

  it("价格分析模型失败时保留本地事实回退", async () => {
    callDeepSeekJson.mockRejectedValueOnce(new Error("temporary failure"));
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想吃咖喱，给我价格建议", recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(payload).toMatchObject({ source: "RULES", needsNewRecommendation: false });
    expect(payload.fallbackReason).toContain("temporary failure");
    expect(payload.reply).toContain("建议把这一顿控制在");
  });

  it("保留模型分析，同时修正仅凭均价推断超限频率的措辞", async () => {
    callDeepSeekJson.mockResolvedValueOnce({ reply: "咖喱近14天净均价为¥28.90，因此经常超出¥25.00上限；今天最好控制在15元以内，这是咖喱建议餐价。" });
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想吃咖喱，给我价格建议", recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(payload.source, JSON.stringify(payload)).toBe("LLM");
    expect(payload.reply).toContain("近期净均价高于");
    expect(payload.reply).not.toContain("经常超出");
    expect(payload.reply).toContain("正餐建议餐价");
    expect(payload.reply).toContain("15.00元左右");
    expect(payload.reply).not.toContain("15元以内");
    expect(payload.reply).toContain("当前没有可直接比较的咖喱候选");
  });

  it("模型混淆总剩余预算和建议日预算时要求修正后再返回", async () => {
    callDeepSeekJson
      .mockImplementationOnce(async (_system: string, user: string) => {
        const facts = JSON.parse(user) as { subject: string; configuredRecommendedMealPriceYuan: string; configuredAcceptableUpperLimitYuan: string; recommendedDailyBudgetYuan: string };
        return { reply: `${facts.subject}的通用正餐建议价是¥${facts.configuredRecommendedMealPriceYuan}，上限¥${facts.configuredAcceptableUpperLimitYuan}。今天剩余预算为¥${facts.recommendedDailyBudgetYuan}，当前没有可直接比较的${facts.subject}候选。` };
      })
      .mockImplementationOnce(async (_system: string, user: string) => {
        const facts = JSON.parse(user) as { subject: string; configuredRecommendedMealPriceYuan: string; configuredAcceptableUpperLimitYuan: string; remainingBudgetYuan: string; recommendedDailyBudgetYuan: string };
        return { reply: `${facts.subject}的通用正餐建议价是¥${facts.configuredRecommendedMealPriceYuan}，上限¥${facts.configuredAcceptableUpperLimitYuan}。总剩余预算是¥${facts.remainingBudgetYuan}，后续建议日预算是¥${facts.recommendedDailyBudgetYuan}；当前没有可直接比较的${facts.subject}候选。` };
      });
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想吃日料，给我价格建议", recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(payload.source, JSON.stringify(payload)).toBe("LLM");
    expect(payload.reply).toContain("总剩余预算");
    expect(payload.reply).toContain("后续建议日预算");
    expect(payload.reply).not.toContain("今天剩余预算");
  });

  it("近期均价超过上限时不会描述为仍在上限附近", async () => {
    callDeepSeekJson.mockResolvedValueOnce({ reply: "日料的正餐建议价是¥15.00，上限是¥25.00。近期净均价¥28.90高于建议价，但仍在可接受上限附近；当前没有可直接比较的日料候选。" });
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想吃日料，给我价格建议", recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(payload.source, JSON.stringify(payload)).toBe("LLM");
    expect(payload.reply).toContain("已经高于可接受上限");
    expect(payload.reply).not.toContain("仍在可接受上限附近");
  });

  it("用户明确说明已经购买时返回结构化记账草稿而不直接写账", async () => {
    const response = await POST(new Request("http://localhost/api/meal-recommendations/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我买了一份35元的玛格丽特，尝试一下", recommendations: [] }),
    }) as Parameters<typeof POST>[0]);
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({
      source: "RULES",
      needsNewRecommendation: false,
      purchaseDraft: { itemName: "玛格丽特", actualPriceCents: 3_500 },
    });
    expect(payload.reply).toContain("只有再次确认后才会写入账本");
  });
});
