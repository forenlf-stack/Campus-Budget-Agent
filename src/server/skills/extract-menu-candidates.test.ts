import { describe, expect, it, vi } from "vitest";

import type { MenuRecognitionProvider } from "@/server/menu-recognition/menu-recognition-provider";
import { extractMenuCandidates } from "./extract-menu-candidates";

function provider(output: unknown): MenuRecognitionProvider {
  return { recognize: vi.fn().mockResolvedValue(output) };
}

const input = { image: "base64-image-data", mimeType: "image/jpeg" as const };

function recognizedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    name: "鸡腿饭",
    priceCents: 1_500,
    priceText: "15元",
    description: "鸡腿配米饭",
    visibleTags: ["米饭"],
    confidence: 0.96,
    rawTextReference: "鸡腿饭 15元",
    ...overrides,
  };
}

describe("extract_menu_candidates", () => {
  it("提取清晰菜单候选并标记VISION来源", async () => {
    const result = await extractMenuCandidates(input, provider(JSON.stringify({ candidates: [recognizedCandidate()] })));

    expect(result).toMatchObject({
      success: true,
      data: {
        rejectedCandidateCount: 0,
        candidates: [{
          temporaryId: "vision-1",
          name: "鸡腿饭",
          priceCents: 1_500,
          source: "VISION",
          needsConfirmation: false,
          risks: [],
        }],
      },
    });
  });

  it("低置信度和模糊证据要求确认且不采用价格", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      priceText: "价格模糊",
      rawTextReference: "鸡腿饭 价格看不清",
      confidence: 0.45,
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: null, needsConfirmation: true }] } });
    if (result.success) {
      expect(result.data.candidates[0].risks).toEqual(expect.arrayContaining(["LOW_CONFIDENCE", "IMAGE_BLURRY", "PRICE_UNCERTAIN"]));
    }
  });

  it("价格缺失时保留文字证据但不猜价格", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      priceCents: null,
      priceText: "价格不清",
      rawTextReference: "牛肉面 价格不清",
      name: "牛肉面",
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ name: "牛肉面", priceCents: null, priceText: "价格不清", needsConfirmation: true }] } });
    if (result.success) expect(result.data.candidates[0].risks).toContain("PRICE_UNCERTAIN");
  });

  it("会员资格价不明确时不选择价格", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      priceCents: 1_200,
      priceText: "会员价12元",
      rawTextReference: "鸡腿饭 会员专享12元",
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: null, needsConfirmation: true }] } });
    if (result.success) expect(result.data.candidates[0].risks).toEqual(expect.arrayContaining(["MEMBER_PRICE", "PRICE_UNCERTAIN"]));
  });

  it("完整套餐的明确整套价格可以直接参与推荐", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      name: "【省薪3件套】鸡腿饭+小吃+饮品",
      priceCents: 2_190,
      priceText: "¥21.9 神券价",
      rawTextReference: "【省薪3件套】鸡腿饭+小吃+饮品 ¥21.9 神券价 已含券",
      risks: ["SET_PRICE", "PRICE_UNCERTAIN"],
      needsConfirmation: true,
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: 2_190, needsConfirmation: false, risks: [] }] } });
  });

  it("模型漏填priceCents时从明确的套餐现价证据恢复价格", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      name: "【省薪3件套】招牌红碗豌杂面+鸡架",
      priceCents: null,
      priceText: "¥24.9 神券价",
      rawTextReference: "【省薪3件套】招牌红碗豌杂面+鸡架 / ¥24.9 神券价 已含券",
      risks: ["SET_PRICE", "PRICE_UNCERTAIN"],
      needsConfirmation: true,
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: 2_490, needsConfirmation: false, risks: [] }] } });
  });

  it("原价与现价同时出现时只采用明确标注的神券价", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      name: "【省薪3件套】酸菜卤肉饭+小吃+饮品",
      priceCents: null,
      priceText: "¥21.9 神券价",
      rawTextReference: "原价¥31 【省薪3件套】酸菜卤肉饭+小吃+饮品 ¥21.9神券价 已含券",
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: 2_190, needsConfirmation: false }] } });
  });

  it("多规格或选套餐后价格仍要求确认", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [recognizedCandidate({
      priceText: "20元起",
      rawTextReference: "鸡腿饭套餐 20元起 选规格",
    })] }));

    expect(result).toMatchObject({ success: true, data: { candidates: [{ priceCents: null, needsConfirmation: true }] } });
    if (result.success) expect(result.data.candidates[0].risks).toEqual(expect.arrayContaining(["SET_PRICE", "PRICE_UNCERTAIN"]));
  });

  it("provider返回非法JSON时返回稳定失败", async () => {
    const result = await extractMenuCandidates(input, provider("{not-json"));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_MENU_RECOGNITION_OUTPUT" } });
  });

  it("provider超时返回稳定超时错误", async () => {
    const timedOut: MenuRecognitionProvider = { recognize: vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "AbortError" })) };
    const result = await extractMenuCandidates(input, timedOut);
    expect(result).toMatchObject({ success: false, error: { code: "MENU_RECOGNITION_TIMEOUT" } });
  });

  it("单项结构失败时继续处理其余候选", async () => {
    const result = await extractMenuCandidates(input, provider({ candidates: [
      recognizedCandidate(),
      { name: "缺少证据", confidence: 0.9 },
      recognizedCandidate({ name: "牛肉面", rawTextReference: "牛肉面 18元", priceCents: 1_800, priceText: "18元" }),
    ] }));

    expect(result).toMatchObject({ success: true, data: { rejectedCandidateCount: 1 } });
    if (result.success) expect(result.data.candidates.map((candidate) => candidate.name)).toEqual(["鸡腿饭", "牛肉面"]);
  });
});
