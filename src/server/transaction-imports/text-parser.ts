import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import type { ImportedTransactionCandidate } from "@/lib/transaction-imports";
import { callDeepSeekJson } from "@/server/llm/deepseek-client";
import { candidate, detectType, normalizeAmountCents, normalizeDate } from "./import-utils";

const modelSchema = z.object({ transactions: z.array(z.object({
  type: z.enum(["EXPENSE", "INCOME", "REFUND"]),
  amountCents: z.coerce.number().int().positive(),
  occurredAt: z.string(),
  itemName: z.string().trim().min(1).max(100),
  merchant: z.string().trim().max(100).default(""),
  category: z.enum(["MEAL", "SNACK_DRINK", "DAILY_NECESSITY", "STUDY", "TRANSPORT", "GAME_ENTERTAINMENT", "RECHARGE_SUBSCRIPTION", "MEDICAL", "OTHER"]).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.8),
  rawReference: z.string().trim().min(1).max(1000),
}).passthrough()).max(1000) }).passthrough();

function localParse(text: string) {
  return text.split(/\r?\n/).flatMap((line, index): ImportedTransactionCandidate[] => {
    const amount = line.match(/(?:支出|收入|消费|付款|收款|退款|金额|共计|合计)?\s*(?:¥|￥)?\s*([+-]?\d+(?:\.\d{1,2})?)\s*(?:元|块)/);
    const date = line.match(/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
    const amountCents = normalizeAmountCents(amount?.[1]);
    const occurredAt = normalizeDate(date?.[1]);
    if (!amountCents || !occurredAt) return [];
    const itemName = line.replace(amount?.[0] ?? "", "").replace(date?.[0] ?? "", "").replace(/[，,;；|]/g, " ").trim() || `文字导入交易${index + 1}`;
    return [candidate({ source: "TEXT", type: detectType(line, amount?.[1]), amountCents, occurredAt, itemName: itemName.slice(0, 100), merchant: "", rawReference: line, confidence: 0.65, needsReview: true, reviewReasons: ["本地基础解析，请核对商家和分类"] })];
  });
}

export async function parseTransactionText(text: string) {
  try {
    const output = await callDeepSeekJson(
      "你是账单导入信息提取器。用户主动提供了微信、支付宝、银行短信或口述交易记录。逐笔提取真实存在的交易，不得创造或合并交易。金额使用整数分，时间转为ISO 8601（中国时区信息缺失时按+08:00）。退款为REFUND，收入为INCOME，其余为EXPENSE。category只能使用MEAL,SNACK_DRINK,DAILY_NECESSITY,STUDY,TRANSPORT,GAME_ENTERTAINMENT,RECHARGE_SUBSCRIPTION,MEDICAL,OTHER；收入category为null。不确定内容降低confidence并保留rawReference。只返回JSON。",
      text,
      modelSchema,
      { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
    );
    const candidates = output.transactions.flatMap((item): ImportedTransactionCandidate[] => {
      const occurredAt = normalizeDate(item.occurredAt);
      if (!occurredAt) return [];
      return [candidate({ source: "TEXT", ...item, occurredAt, rawReference: item.rawReference, needsReview: item.confidence < 0.75, reviewReasons: item.confidence < 0.75 ? ["模型置信度较低"] : [] })];
    });
    return { candidates, rejectedCount: output.transactions.length - candidates.length, warnings: [] };
  } catch (error) {
    const candidates = localParse(text);
    const reason = error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "未知错误";
    return { candidates, rejectedCount: 0, warnings: [`模型解析不可用，已使用本地基础解析：${reason}`] };
  }
}
