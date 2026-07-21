import { NextResponse } from "next/server";
import { z } from "zod";

import { agentCapabilities } from "@/lib/agent-capabilities";
import { billAnalysisResponseSchema } from "@/lib/bill-analysis";
import type { BillAnalysisResponse } from "@/lib/bill-analysis";
import { centsToYuan, signedCentsToYuan } from "@/lib/money";
import { buildBillAnalysis } from "@/server/bill-analysis";
import { callDeepSeekJson } from "@/server/llm/deepseek-client";
import { listTransactionsBetween } from "@/server/transaction-store";
import { requireApiUser } from "@/server/auth";

export const runtime = "nodejs";

const agentSchema = z.object({
  overview: z.string().trim().min(1).max(1200),
  observations: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  suggestions: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  toneNote: z.string().trim().min(1).max(200),
}).passthrough();

function signedYuanLabel(cents: number) {
  const value = signedCentsToYuan(cents);
  return value.startsWith("-") ? `-¥${value.slice(1)}` : `¥${value}`;
}

function ruleAgent(analysis: ReturnType<typeof buildBillAnalysis>, reason?: string) {
  const top = analysis.summary.topCategories[0];
  const seven = analysis.windows.find((item) => item.key === "DAYS_7");
  return {
    overview: top ? `最近90天支出主要集中在${top.label}，占比约${top.sharePercent}%。${seven ? `最近7天净支出${signedYuanLabel(seven.currentSpendingCents)}。` : ""}` : "当前账单记录较少，暂时还看不出稳定的消费结构。",
    observations: [top ? `${top.label}是当前金额最高的分类，合计¥${centsToYuan(top.amountCents)}` : "分类数据不足", ...(seven ? [`最近7天日均净支出约${signedYuanLabel(seven.dailyAverageCents)}`] : [])],
    suggestions: ["先关注金额最高的分类是否包含可延后或可替代的消费", "继续记录一段时间后再观察趋势，避免根据单笔消费过度调整"],
    toneNote: "这些建议用于帮助你理解消费习惯，不代表所有高支出都不合理。",
    source: "RULES" as const,
    ...(reason ? { fallbackReason: reason } : {}),
  };
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const now = new Date();
    const rows = listTransactionsBetween(user.id, new Date(now.getTime() - 180 * 86_400_000), now);
    const analysis = buildBillAnalysis(rows, now);
    const agentFacts = {
      summary: {
        totalSpendingYuan: signedCentsToYuan(analysis.summary.totalSpendingCents),
        transactionCount: analysis.summary.transactionCount,
        topCategories: analysis.summary.topCategories.map((item) => ({ label: item.label, amountYuan: centsToYuan(item.amountCents), sharePercent: item.sharePercent })),
        highestSpendingDays: analysis.summary.highestSpendingDays.map((item) => ({ date: item.date, netSpendingYuan: centsToYuan(item.amountCents) })),
        highestSpendingPeriods: analysis.summary.highestSpendingPeriods.map((item) => ({ label: item.label, netSpendingYuan: centsToYuan(item.amountCents) })),
      },
      windows: analysis.windows.map((item) => ({ label: item.label, currentYuan: signedCentsToYuan(item.currentSpendingCents), previousYuan: signedCentsToYuan(item.previousSpendingCents), changeYuan: signedCentsToYuan(item.changeCents), changePercent: item.changePercent, dailyAverageYuan: signedCentsToYuan(item.dailyAverageCents), transactionCount: item.transactionCount })),
    };
    let agent: BillAnalysisResponse["agent"] = ruleAgent(analysis);
    try {
      const response = await callDeepSeekJson(
        `你是温和、务实的个人账单分析 Agent。基于本地程序从完整账单计算出的精确净支出摘要，分析钱主要花在哪里、哪些日期或时段偏高，以及最近3天、7天、30天、90天相较上一等长周期发生了什么变化。
所有金额、占比、变化率必须引用输入，不得自行计算或虚构。区分一次性大额和持续趋势，数据不足时明确说明。
输入金额已经按支出减退款计算为净额。不得把退款前单笔金额、毛支出或不存在的交易原因写入回答；输入未提供某笔消费的项目名称时，不得猜测原因。
建议应具体、可执行、有参考价值，但不要命令式、羞辱或制造焦虑。医疗、学习、必要正餐和交通等支出不能仅因金额较高就定义为浪费，应关注是否异常、是否符合用户目标。不要建议极端节食或影响基本生活。
overview 用一段自然中文总结；observations 提供3到6条有数据依据的观察；suggestions 提供2到5条温和建议；toneNote 用一句话说明建议的边界。只返回JSON。`,
        JSON.stringify({ generatedAt: now.toISOString(), facts: agentFacts }),
        agentSchema,
        { timeoutMs: agentCapabilities.model.defaultTimeoutMs, thinking: "enabled" },
      );
      agent = { ...response, source: "LLM" as const };
    } catch (error) {
      agent = ruleAgent(analysis, error instanceof Error ? error.message : "模型响应不可用");
    }
    return NextResponse.json(billAnalysisResponseSchema.parse({ generatedAt: now.toISOString(), ...analysis, agent }));
  } catch (error) {
    return NextResponse.json({ error: { code: "BILL_ANALYSIS_ERROR", message: error instanceof Error ? error.message : "账单分析失败" } }, { status: 500 });
  }
}
