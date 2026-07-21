import Link from "next/link";

import { centsToYuan } from "@/lib/money";
import { categoryLabels } from "@/lib/settings";
import { getCurrentPeriod } from "@/server/settings-store";
import { listTransactions } from "@/server/transaction-store";
import { requireUser } from "@/server/auth";
import { UserMenu } from "@/app/components/user-menu";

export const dynamic = "force-dynamic";

const links = [
  { href: "/eat-what", icon: "餐", tone: "from-orange-500 to-amber-400", title: "今天吃什么", description: "按预算、偏好和近期选择直接推荐" },
  { href: "/buy-or-not", icon: "买", tone: "from-teal-600 to-emerald-400", title: "零食饮料买不买", description: "根据近7天频率和总预算给出购买建议" },
  { href: "/transactions", icon: "账", tone: "from-sky-600 to-cyan-400", title: "收支记录", description: "查看和维护日常交易" },
  { href: "/transaction-imports", icon: "导", tone: "from-violet-600 to-fuchsia-400", title: "导入交易记录", description: "从文字、截图或 Excel 预览并导入账单" },
  { href: "/bill-analysis", icon: "析", tone: "from-indigo-600 to-blue-400", title: "账单分析与建议", description: "查看消费结构、周期变化和 Agent 建议" },
  { href: "/settings/preferences", icon: "设", tone: "from-slate-700 to-slate-500", title: "预算与偏好", description: "设置预算、地点、口味与忌口" },
  { href: "/meal-candidates", icon: "库", tone: "from-rose-500 to-orange-400", title: "餐食候选", description: "维护吃过或愿意选择的餐食" },
];

function signedYuan(cents: number) {
  return `${cents < 0 ? "-" : ""}¥${centsToYuan(Math.abs(cents))}`;
}

export default async function Home() {
  const user = await requireUser();
  const period = getCurrentPeriod();
  const { budget } = listTransactions(user.id, { period });
  const spentRatio = budget.plannedVariableBudgetCents > 0
    ? Math.round((budget.netVariableSpendingCents / budget.plannedVariableBudgetCents) * 100)
    : 0;
  const ringRatio = Math.max(0, Math.min(spentRatio, 100));
  const circumference = 2 * Math.PI * 52;
  const dashOffset = circumference * (1 - ringRatio / 100);
  const categoryRows = budget.categories.filter((item) => item.netSpendingCents > 0);
  const categoryTotal = categoryRows.reduce((total, item) => total + item.netSpendingCents, 0);

  return <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-6xl">
    <header className="flex items-start justify-between gap-4"><div><p className="page-kicker">学生消费助手</p><h1 className="page-heading mt-5 text-4xl sm:text-5xl">轻量决策，<span className="bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">从今天开始。</span></h1><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">把预算、账单与日常选择放在一起，需要时快速得到清晰、可执行的参考。</p><Link href="/settings/models" className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100">模型设置 <span aria-hidden="true">→</span></Link></div><UserMenu user={user} /></header>

    <section className="surface-card mt-10 overflow-hidden rounded-[2rem] p-6 sm:p-8" aria-labelledby="budget-dashboard-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-teal-700">{period} 预算执行</p><h2 id="budget-dashboard-title" className="mt-1 text-2xl font-bold">当前预算仪表盘</h2></div><Link href="/transactions" className="text-sm font-semibold text-teal-700 underline-offset-4 hover:underline">查看收支明细</Link></div>
      <div className="mt-6 grid items-center gap-4 sm:grid-cols-[150px_1fr]">
        <div className="grid place-items-center">
          <svg viewBox="0 0 140 140" className="size-32" role="img" aria-label={`可变预算已使用 ${spentRatio}%`}>
            <title>可变预算执行率</title>
            <circle cx="70" cy="70" r="52" fill="none" stroke="#e7e5e4" strokeWidth="14" />
            <circle cx="70" cy="70" r="52" fill="none" stroke={spentRatio > 100 ? "#b91c1c" : spentRatio >= 80 ? "#d97706" : "#0f766e"} strokeWidth="14" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} transform="rotate(-90 70 70)" />
            <text x="70" y="65" textAnchor="middle" className="fill-slate-900 text-[24px] font-bold">{spentRatio}%</text>
            <text x="70" y="86" textAnchor="middle" className="fill-slate-500 text-[11px]">已执行</text>
          </svg>
          {spentRatio > 100 && <p className="mt-1 text-center text-xs font-semibold text-red-700">超出 {signedYuan(budget.netVariableSpendingCents - budget.plannedVariableBudgetCents)}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 to-indigo-950 p-5 text-white shadow-lg shadow-indigo-950/10"><div aria-hidden="true" className="absolute -right-8 -top-8 size-24 rounded-full border-[18px] border-white/5" /><p className="relative text-xs text-slate-300">当前可用余额</p><p className="relative mt-2 text-2xl font-black">{signedYuan(budget.currentBalanceCents)}</p><p className="relative mt-1 text-[11px] text-slate-400">随收支与生活费自动更新</p></div><div className="rounded-3xl bg-indigo-50 p-5 text-indigo-950"><p className="text-xs text-indigo-600">本月总消费预算</p><p className="mt-2 text-2xl font-black">¥{centsToYuan(Math.max(budget.plannedVariableBudgetCents, 0))}</p></div><div className="rounded-3xl bg-stone-100/80 p-5"><p className="text-xs text-slate-500">实际净支出</p><p className="mt-2 text-2xl font-black">{signedYuan(budget.netVariableSpendingCents)}</p></div><div className={`rounded-3xl p-5 ${budget.remainingBudgetCents < 0 ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-900"}`}><p className="text-xs opacity-75">总预算剩余</p><p className="mt-2 text-2xl font-black">{signedYuan(budget.remainingBudgetCents)}</p></div></div>
      </div>
      <details className="group mt-5 border-t border-stone-200 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
          <span>分类支出占比</span>
          <span aria-hidden="true" className="text-lg text-slate-400 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="px-2 pb-2 pt-3"><p className="text-xs text-slate-500">分类用于观察钱花在哪里，不再单独设置预算上限。</p>{categoryRows.length > 0 ? <div className="mt-4 grid gap-4 sm:grid-cols-2">{categoryRows.map((item) => {
            const ratio = categoryTotal > 0 ? Math.round((item.netSpendingCents / categoryTotal) * 100) : 0;
            return <div key={item.category}><div className="flex justify-between gap-3 text-sm"><span className="font-medium">{categoryLabels[item.category]}</span><span className="text-slate-500">{ratio}% · ¥{centsToYuan(item.netSpendingCents)}</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-label={`${categoryLabels[item.category]}支出占比`} aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-teal-700" style={{ width: `${ratio}%` }} /></div></div>;
          })}</div> : <p className="mt-3 text-sm text-slate-500">本月暂无分类支出。</p>}</div>
      </details>
    </section>

    <div className="mt-10 flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Quick actions</p><h2 className="mt-1 text-2xl font-black tracking-tight">今天想做什么？</h2></div><p className="hidden text-xs text-slate-400 sm:block">选择一个入口开始</p></div>
    <nav className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{links.map((item) => <Link key={item.href} href={item.href} className="group surface-card relative overflow-hidden rounded-3xl p-5 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_18px_45px_rgba(79,70,229,0.11)]"><div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${item.tone} text-sm font-black text-white shadow-sm`}>{item.icon}</div><h2 className="mt-5 flex items-center justify-between gap-3 text-lg font-bold"><span>{item.title}</span><span aria-hidden="true" className="text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-600">→</span></h2><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p></Link>)}</nav>
  </div></main>;
}
