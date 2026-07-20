"use client";

import { useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { confirmSnackPurchaseResponseSchema, snackDecisionResponseSchema, type SnackDecisionResponse } from "@/lib/snack-decisions";
import { centsToYuan, yuanToCents } from "@/lib/money";

function localDateTimeValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const styles = {
  GREEN: "border-emerald-200 bg-emerald-50 text-emerald-950",
  YELLOW: "border-amber-200 bg-amber-50 text-amber-950",
  RED: "border-red-200 bg-red-50 text-red-950",
} as const;

const purchaseActionLabels = {
  GREEN: "确认购买并记账",
  YELLOW: "接受提醒，确认购买并记账",
  RED: "了解风险，仍要购买并记账",
} as const;

function signedYuan(cents: number) {
  return `${cents < 0 ? "-" : ""}¥${centsToYuan(Math.abs(cents))}`;
}

export function BuyOrNotClient() {
  const [itemName, setItemName] = useState("");
  const [price, setPrice] = useState("");
  const [merchant, setMerchant] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue());
  const [decision, setDecision] = useState<SnackDecisionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function comparisonText() {
    if (!decision) return "";
    const change = decision.context.recentSpendingCents - decision.context.previousWeekSpendingCents;
    if (decision.context.previousWeekSpendingCents === 0) return decision.context.recentSpendingCents > 0 ? "前7天暂无同类支出" : "最近两周都没有同类支出";
    return `较前7天${change > 0 ? "增加" : change < 0 ? "减少" : "持平"} ${signedYuan(Math.abs(change))}`;
  }

  async function evaluate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage(""); setDecision(null);
    try {
      const priceCents = yuanToCents(price);
      if (priceCents <= 0) throw new Error("请输入大于0的价格");
      const response = await fetch("/api/purchase-decisions/snack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemName, priceCents, merchant, occurredAt: new Date(occurredAt).toISOString() }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "object" && payload.error && "message" in payload.error ? String(payload.error.message) : "判断失败");
      setDecision(snackDecisionResponseSchema.parse(payload));
      setIdempotencyKey(crypto.randomUUID());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "判断失败"); }
    finally { setLoading(false); }
  }

  async function confirmPurchase() {
    if (!decision) return;
    setRecording(true); setError("");
    try {
      const response = await fetch("/api/purchase-decisions/snack/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey, itemName, priceCents: yuanToCents(price), merchant, occurredAt: new Date(occurredAt).toISOString(), level: decision.level, recommendation: decision.recommendation, decisionTitle: decision.title }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "object" && payload.error && "message" in payload.error ? String(payload.error.message) : "记账失败");
      const result = confirmSnackPurchaseResponseSchema.parse(payload);
      setMessage(`已确认购买并记入零食饮料支出，当前总预算剩余 ${signedYuan(result.budgetAfter.remainingBudgetCents)}。`); setDecision(null); setItemName(""); setPrice(""); setMerchant("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "记账失败"); }
    finally { setRecording(false); }
  }

  return <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-3xl">
    <HomeLink />
    <header className="mt-8 max-w-2xl"><p className="page-kicker">消费前决策</p><h1 className="page-heading mt-4 text-4xl">零食饮料买不买？</h1><p className="mt-3 text-sm leading-7 text-slate-600">输入这次想买的东西和价格，Agent 会结合近 7 天频率、偏好上限和总预算给出建议。</p></header>
    <form onSubmit={evaluate} className="surface-card mt-8 grid gap-5 rounded-[2rem] p-6 sm:grid-cols-2 sm:p-7">
      <label className="grid gap-2 text-sm font-medium">商品名称<input required value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="例如：奶茶" className="rounded-xl border border-slate-200 px-4 py-3" /></label>
      <label className="grid gap-2 text-sm font-medium">价格（元）<input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="例如：16.00" className="rounded-xl border border-slate-200 px-4 py-3" /></label>
      <label className="grid gap-2 text-sm font-medium">商家（可选）<input value={merchant} onChange={(event) => setMerchant(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3" /></label>
      <label className="grid gap-2 text-sm font-medium">预计购买时间<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3" /></label>
      <button disabled={loading} className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-3.5 font-bold text-white shadow-lg shadow-teal-700/15 hover:-translate-y-0.5 disabled:bg-slate-300 sm:col-span-2">{loading ? "正在判断…" : "让 Agent 帮我判断 →"}</button>
    </form>
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {decision && <section className={`mt-6 rounded-3xl border p-6 ${styles[decision.level]}`}><p className="text-xs font-semibold tracking-wide">{decision.level === "GREEN" ? "绿色建议" : decision.level === "YELLOW" ? "黄色提醒" : "红色提醒"}</p><h2 className="mt-2 text-2xl font-bold">{decision.title}</h2>{decision.agentComment && <div className="mt-4 rounded-2xl bg-white/65 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold">Agent 点评</p><span className="text-xs opacity-60">{decision.agentSource === "LLM" ? "DeepSeek" : "本地规则"}</span></div><p className="mt-2 text-sm leading-6">{decision.agentComment}</p></div>}<div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white/55 p-3"><p className="text-xs opacity-65">近7天</p><p className="mt-1 font-semibold">{decision.context.recentCount} 次 · {signedYuan(decision.context.recentSpendingCents)}</p><p className="mt-1 text-xs opacity-65">{comparisonText()}</p></div><div className="rounded-xl bg-white/55 p-3"><p className="text-xs opacity-65">近期平均单价</p><p className="mt-1 font-semibold">{decision.context.recentAveragePriceCents > 0 ? signedYuan(decision.context.recentAveragePriceCents) : "暂无记录"}</p><p className="mt-1 text-xs opacity-65">本次 {signedYuan(yuanToCents(price))}</p></div><div className="rounded-xl bg-white/55 p-3"><p className="text-xs opacity-65">本次购买后</p><p className="mt-1 font-semibold">预算剩余 {signedYuan(decision.context.remainingBudgetAfterCents)}</p><p className="mt-1 text-xs opacity-65">周额度余量 {signedYuan(decision.context.weeklyBudgetRemainingAfterCents)}</p></div></div><details className="mt-5 border-t border-current/10 pt-4"><summary className="cursor-pointer text-sm font-semibold">查看判断依据</summary><div className="mt-3 grid gap-2 text-sm">{decision.reasons.map((reason) => <p key={reason}>• {reason}</p>)}</div>{decision.alternatives.length > 0 && <div className="mt-4 rounded-2xl bg-white/60 p-4"><p className="font-semibold">可以这样调整</p>{decision.alternatives.map((item) => <p key={item} className="mt-2 text-sm">• {item}</p>)}</div>}</details><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => void confirmPurchase()} disabled={recording} className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-50">{recording ? "正在记账…" : purchaseActionLabels[decision.level]}</button><button onClick={() => { setDecision(null); setMessage("已选择暂不购买，本次不会记账。"); }} className="rounded-xl border border-current px-5 py-3 font-semibold">暂不购买</button></div></section>}
  </div></main>;
}
