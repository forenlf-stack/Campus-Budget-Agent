import { z } from "zod";

import type { ImportedTransactionCandidate } from "@/lib/transaction-imports";
import { readModelConfig } from "@/server/model-config-store";
import { candidate, normalizeDate } from "./import-utils";

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });
const outputSchema = z.object({ transactions: z.array(z.object({
  type: z.enum(["EXPENSE", "INCOME", "REFUND"]), category: z.enum(["MEAL", "SNACK_DRINK", "DAILY_NECESSITY", "STUDY", "TRANSPORT", "GAME_ENTERTAINMENT", "RECHARGE_SUBSCRIPTION", "MEDICAL", "OTHER"]).nullable(),
  amountCents: z.coerce.number().int().positive(), occurredAt: z.string(), itemName: z.string(), merchant: z.string().default(""), confidence: z.number().min(0).max(1), rawReference: z.string(),
}).passthrough()).max(200) }).passthrough();

export async function parseTransactionImage(image: string, mimeType: string) {
  const config = readModelConfig();
  if (!config.visionApiKey) throw new Error("未配置多模态模型 API Key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${config.visionBaseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.visionApiKey}` }, body: JSON.stringify({
      model: config.visionModel,
      messages: [{ role: "system", content: "你是账单截图提取器。只提取图片中明确可见的逐笔交易，不得猜测。支持微信、支付宝账单和银行支付短信截图。区分支出EXPENSE、收入INCOME、退款REFUND；金额为整数分；时间输出ISO 8601，缺少年份或时间时降低confidence。分类只能使用MEAL,SNACK_DRINK,DAILY_NECESSITY,STUDY,TRANSPORT,GAME_ENTERTAINMENT,RECHARGE_SUBSCRIPTION,MEDICAL,OTHER，收入category为null。rawReference引用可见证据。只返回JSON {transactions:[]}。" }, { role: "user", content: [{ type: "text", text: "提取这张图片中的全部可见交易记录。" }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}`, detail: "high" } }] }], temperature: 0, max_completion_tokens: 4000,
    }), signal: controller.signal });
    if (!response.ok) throw new Error(`多模态账单识别返回 ${response.status}`);
    const content = responseSchema.parse(await response.json()).choices[0].message.content;
    if (!content) throw new Error("多模态模型未返回内容");
    const parsed = outputSchema.parse(JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
    const candidates = parsed.transactions.flatMap((item): ImportedTransactionCandidate[] => {
      const occurredAt = normalizeDate(item.occurredAt);
      if (!occurredAt) return [];
      return [candidate({ source: "IMAGE", ...item, occurredAt, rawReference: item.rawReference, needsReview: item.confidence < 0.8, reviewReasons: item.confidence < 0.8 ? ["图片识别置信度较低"] : [] })];
    });
    return { candidates, rejectedCount: parsed.transactions.length - candidates.length, warnings: [] };
  } finally { clearTimeout(timeout); }
}
