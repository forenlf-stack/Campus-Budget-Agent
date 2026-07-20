"use client";

import { useEffect, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { billAnalysisResponseSchema, type BillAnalysisResponse } from "@/lib/bill-analysis";
import { centsToYuan, signedCentsToYuan } from "@/lib/money";

type AnalysisWindow = BillAnalysisResponse["windows"][number];

function signedYuanLabel(cents: number) {
  const value = signedCentsToYuan(cents);
  return value.startsWith("-") ? `-¥${value.slice(1)}` : `¥${value}`;
}

function changeLabel(window: AnalysisWindow) {
  if (window.previousSpendingCents <= 0) return window.currentSpendingCents > 0 ? "上一周期暂无支出" : "两个周期均无支出";
  const direction = window.changeCents > 0 ? "增加" : window.changeCents < 0 ? "减少" : "持平";
  return `${direction} ${window.changePercent === null ? "" : `${Math.abs(window.changePercent)}%`}`.trim();
}

function trendStyle(window: AnalysisWindow) {
  if (window.changeCents > 0) return { badge: "bg-amber-50 text-amber-800 ring-amber-200", arrow: "↗" };
  if (window.changeCents < 0) return { badge: "bg-emerald-50 text-emerald-800 ring-emerald-200", arrow: "↘" };
  return { badge: "bg-slate-100 text-slate-600 ring-slate-200", arrow: "→" };
}

function comparisonWidths(window: AnalysisWindow) {
  const current = Math.max(0, window.currentSpendingCents);
  const previous = Math.max(0, window.previousSpendingCents);
  const maximum = Math.max(current, previous, 1);
  return {
    current: current === 0 ? 0 : Math.max(8, Math.round((current / maximum) * 100)),
    previous: previous === 0 ? 0 : Math.max(8, Math.round((previous / maximum) * 100)),
  };
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function requestBillAnalysis() {
  const response = await fetch("/api/bill-analysis", { cache: "no-store" });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "object" && payload.error && "message" in payload.error ? String(payload.error.message) : "账单分析失败");
  return billAnalysisResponseSchema.parse(payload);
}

function LoadingState() {
  return <div className="mt-8 grid gap-5" aria-live="polite" aria-label="正在生成账单分析">
    <section className="animate-pulse overflow-hidden rounded-[2rem] border border-indigo-100 bg-white shadow-sm">
      <div className="h-52 bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-900 p-7"><div className="h-4 w-28 rounded-full bg-white/20" /><div className="mt-8 h-7 w-3/4 rounded-lg bg-white/15" /><div className="mt-3 h-7 w-1/2 rounded-lg bg-white/10" /></div>
      <div className="grid gap-5 p-7 sm:grid-cols-2"><div className="h-28 rounded-2xl bg-stone-100" /><div className="h-28 rounded-2xl bg-stone-100" /></div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><div className="h-4 w-20 rounded bg-stone-200" /><div className="mt-5 h-8 w-28 rounded bg-stone-200" /><div className="mt-6 h-10 rounded-xl bg-stone-100" /></div>)}</div>
    <p className="text-center text-sm text-slate-500">正在整理最近 180 天账单并生成分析…</p>
  </div>;
}

function TrendCard({ window }: { window: AnalysisWindow }) {
  const trend = trendStyle(window);
  const widths = comparisonWidths(window);
  return <article className="group rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_16px_40px_rgba(79,70,229,0.10)]">
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-700">{window.label}</p><p className="mt-1 text-xs text-slate-400">{window.transactionCount} 笔交易</p></div><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${trend.badge}`}><span aria-hidden="true">{trend.arrow}</span>{changeLabel(window)}</span></div>
    <p className="mt-5 text-3xl font-black tracking-tight text-slate-950">{signedYuanLabel(window.currentSpendingCents)}</p>
    <p className="mt-1 text-xs text-slate-500">日均 {signedYuanLabel(window.dailyAverageCents)}</p>
    <div className="mt-5 space-y-2.5 border-t border-stone-100 pt-4 text-[11px] text-slate-500">
      <div className="grid grid-cols-[42px_1fr_auto] items-center gap-2"><span>本周期</span><div className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${widths.current}%` }} /></div><span className="font-medium text-slate-700">{signedYuanLabel(window.currentSpendingCents)}</span></div>
      <div className="grid grid-cols-[42px_1fr_auto] items-center gap-2"><span>上周期</span><div className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-stone-300 transition-all" style={{ width: `${widths.previous}%` }} /></div><span>{signedYuanLabel(window.previousSpendingCents)}</span></div>
    </div>
  </article>;
}

export function BillAnalysisClient() {
  const [data, setData] = useState<BillAnalysisResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await requestBillAnalysis());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账单分析失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void requestBillAnalysis()
      .then((payload) => { if (active) setData(payload); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "账单分析失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <main className="relative min-h-screen overflow-hidden bg-[#f7f7f4] px-4 py-8 text-slate-900 sm:px-6 sm:py-10">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_10%_10%,rgba(99,102,241,0.12),transparent_36%),radial-gradient(circle_at_88%_4%,rgba(20,184,166,0.10),transparent_32%)]" />
    <div className="relative mx-auto max-w-6xl">
      <div className="flex items-center justify-between gap-4"><HomeLink />{data && <span className="hidden items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-xs text-slate-500 shadow-sm backdrop-blur sm:inline-flex"><span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />更新于 {formatGeneratedAt(data.generatedAt)}</span>}</div>

      <header className="mt-8 max-w-3xl sm:mt-10"><div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1.5 text-xs font-bold tracking-wide text-indigo-700"><span aria-hidden="true">✦</span> 消费复盘</div><h1 className="mt-4 text-4xl font-black tracking-[-0.035em] text-slate-950 sm:text-5xl">看清钱花在哪里，<br className="hidden sm:block" /><span className="bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">再决定下一步。</span></h1><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">本地程序负责准确统计，Agent 负责解释变化。数据只在你的账户中使用，建议仅作为温和的消费参考。</p></header>

      {loading && !data && <LoadingState />}
      {error && <div role="alert" className="mt-8 flex flex-col gap-4 rounded-3xl border border-red-200 bg-red-50/90 p-6 text-red-900 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">暂时无法生成分析</p><p className="mt-1 text-sm text-red-700">{error}</p></div><button onClick={() => void load()} className="shrink-0 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">重新分析</button></div>}

      {data && <>
        <section className="mt-8 overflow-hidden rounded-[2rem] border border-indigo-100/80 bg-white shadow-[0_24px_70px_rgba(30,41,59,0.09)]">
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-900 px-6 py-7 text-white sm:px-8 sm:py-9"><div aria-hidden="true" className="absolute -right-20 -top-24 size-64 rounded-full border-[40px] border-white/5" /><div aria-hidden="true" className="absolute bottom-0 right-1/4 h-24 w-52 rounded-full bg-indigo-400/10 blur-3xl" /><div className="relative"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-white/10 text-lg ring-1 ring-white/15" aria-hidden="true">✦</span><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">Agent insight</p><h2 className="mt-1 text-xl font-bold">本次账单总结</h2></div></div><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-indigo-100 ring-1 ring-white/15">{data.agent.source === "LLM" ? "DeepSeek 分析" : "本地规则分析"}</span></div><p className="mt-6 max-w-4xl text-base leading-8 text-indigo-50 sm:text-lg">{data.agent.overview}</p><div className="mt-7 flex flex-wrap gap-3"><div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10"><p className="text-[11px] text-indigo-200">180 天净支出</p><p className="mt-1 text-xl font-bold">{signedYuanLabel(data.summary.totalSpendingCents)}</p></div><div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10"><p className="text-[11px] text-indigo-200">分析交易</p><p className="mt-1 text-xl font-bold">{data.summary.transactionCount} <span className="text-xs font-normal text-indigo-200">笔</span></p></div></div></div></div>
          <div className="grid gap-0 md:grid-cols-2"><div className="border-b border-stone-100 p-6 sm:p-8 md:border-b-0 md:border-r"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-amber-100 text-sm text-amber-800" aria-hidden="true">!</span><h3 className="font-bold text-slate-900">值得关注</h3></div><ul className="mt-5 grid gap-4">{data.agent.observations.map((item, index) => <li key={`${index}-${item}`} className="grid grid-cols-[20px_1fr] gap-3 text-sm leading-6 text-slate-600"><span className="mt-2 size-1.5 rounded-full bg-amber-500" /><span>{item}</span></li>)}</ul></div><div className="p-6 sm:p-8"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-teal-100 text-sm text-teal-800" aria-hidden="true">✓</span><h3 className="font-bold text-slate-900">参考建议</h3></div><ul className="mt-5 grid gap-4">{data.agent.suggestions.map((item, index) => <li key={`${index}-${item}`} className="grid grid-cols-[20px_1fr] gap-3 text-sm leading-6 text-slate-600"><span className="mt-1 grid size-5 place-items-center rounded-full bg-teal-50 text-[10px] font-bold text-teal-700">{index + 1}</span><span>{item}</span></li>)}</ul></div></div>
          <p className="border-t border-indigo-100 bg-indigo-50/70 px-6 py-4 text-xs leading-5 text-indigo-800 sm:px-8"><span className="mr-2" aria-hidden="true">ⓘ</span>{data.agent.toneNote}</p>
        </section>

        <section className="mt-10" aria-labelledby="period-trends-title"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Period trends</p><h2 id="period-trends-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">周期趋势</h2></div><p className="text-xs text-slate-500">与前一个等长周期比较 · 退款已抵扣</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.windows.map((window) => <TrendCard key={window.key} window={window} />)}</div></section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.08fr_0.92fr]" aria-label="消费结构详情">
          <article className="rounded-[2rem] border border-stone-200/80 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:p-8"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Spending mix</p><h2 className="mt-1 text-xl font-black text-slate-950">主要支出方向</h2><p className="mt-2 text-sm text-slate-500">按净支出聚合，帮助判断消费集中度。</p></div>{data.summary.topCategories.length > 0 ? <div className="mt-7 grid gap-6">{data.summary.topCategories.map((item, index) => <div key={item.category}><div className="flex items-end justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-xl bg-stone-100 text-xs font-bold text-slate-500">{String(index + 1).padStart(2, "0")}</span><span className="font-semibold text-slate-800">{item.label}</span></div><div className="text-right"><span className="font-bold text-slate-900">¥{centsToYuan(item.amountCents)}</span><span className="ml-2 text-xs text-slate-400">{item.sharePercent}%</span></div></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-label={`${item.label}支出占比`} aria-valuenow={item.sharePercent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-teal-500" style={{ width: `${Math.min(Math.max(item.sharePercent, 0), 100)}%` }} /></div></div>)}</div> : <div className="mt-8 rounded-2xl bg-stone-50 p-8 text-center text-sm text-slate-500">当前没有可展示的净支出分类。</div>}</article>

          <article className="rounded-[2rem] border border-stone-200/80 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:p-8"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Peak moments</p><h2 className="mt-1 text-xl font-black text-slate-950">支出偏高的日期与时段</h2><p className="mt-2 text-sm text-slate-500">快速发现集中消费出现在哪里。</p></div>{data.summary.highestSpendingDays.length > 0 ? <div className="mt-6 grid gap-2.5">{data.summary.highestSpendingDays.map((item, index) => <div key={item.date} className="flex items-center justify-between rounded-2xl border border-stone-100 bg-stone-50/70 px-4 py-3.5"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-xl bg-white text-xs font-bold text-slate-400 shadow-sm">{index + 1}</span><span className="text-sm font-medium text-slate-700">{item.date}</span></div><strong className="text-sm text-slate-950">¥{centsToYuan(item.amountCents)}</strong></div>)}</div> : <div className="mt-8 rounded-2xl bg-stone-50 p-6 text-center text-sm text-slate-500">暂无明显的高支出日期。</div>}<div className="mt-6 border-t border-stone-100 pt-5"><p className="text-xs font-semibold text-slate-500">高支出时段</p><div className="mt-3 flex flex-wrap gap-2">{data.summary.highestSpendingPeriods.length > 0 ? data.summary.highestSpendingPeriods.map((item) => <span key={item.label} className="rounded-full border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{item.label}<strong className="ml-1.5">¥{centsToYuan(item.amountCents)}</strong></span>) : <span className="text-sm text-slate-400">暂无数据</span>}</div></div></article>
        </section>

        <div className="mt-8 flex flex-col items-center gap-3 pb-6"><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-indigo-950 disabled:cursor-wait disabled:opacity-60"><span className={loading ? "animate-spin" : ""} aria-hidden="true">↻</span>{loading ? "正在重新分析" : "重新生成分析"}</button><p className="text-xs text-slate-400">统计结果由本地代码计算，Agent 不会改写账单金额。</p></div>
      </>}
    </div>
  </main>;
}
