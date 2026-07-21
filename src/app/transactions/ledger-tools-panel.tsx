"use client";

import { useEffect, useState } from "react";

import type { AccountType } from "@/lib/accounts";
import { transactionCategories, type TransactionCategory } from "@/lib/budget";
import { centsToYuan, yuanToCents } from "@/lib/money";
import { categoryLabels } from "@/lib/settings";

export interface AccountRecord { id: string; name: string; type: AccountType; openingBalanceCents: number; balanceCents: number; isDefault: boolean; enabled: boolean }
interface RecurringRecord { id: string; name: string; amountCents: number; nextDueAt: string; reminderDays: number; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; accountName: string | null; daysUntilDue: number; reminderDue: boolean }

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}
function localDateTime() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export function LedgerToolsPanel({ accounts, onTransactionsChanged }: { accounts: AccountRecord[]; onTransactionsChanged: () => void }) {
  const activeAccounts = accounts.filter((item) => item.enabled);
  const [recurring, setRecurring] = useState<RecurringRecord[]>([]);
  const [bill, setBill] = useState({ name: "", amount: "", category: "RECHARGE_SUBSCRIPTION" as TransactionCategory, merchant: "", accountId: "", frequency: "MONTHLY" as "WEEKLY" | "MONTHLY" | "YEARLY", nextDueAt: localDateTime(), reminderDays: "3" });
  const [notice, setNotice] = useState("");

  async function loadRecurring() {
    try { setRecurring(await requestJson("/api/recurring-bills")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "周期账单加载失败"); }
  }
  useEffect(() => { let active = true; void requestJson("/api/recurring-bills").then((items) => { if (active) setRecurring(items); }).catch((error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : "周期账单加载失败"); }); return () => { active = false; }; }, []);
  useEffect(() => { void requestJson("/api/recurring-bills/generate", { method: "POST" }).then((result) => { if (result.count > 0) { setNotice(`已自动生成 ${result.count} 笔到期账单`); onTransactionsChanged(); void requestJson("/api/recurring-bills").then(setRecurring); } }).catch(() => undefined); }, [onTransactionsChanged]);

  async function addRecurring() {
    try {
      await requestJson("/api/recurring-bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: bill.name, type: "EXPENSE", category: bill.category, amountCents: yuanToCents(bill.amount), itemName: bill.name, merchant: bill.merchant, accountId: bill.accountId || activeAccounts[0]?.id || null, note: "自动生成的周期账单", isFixedExpense: true, frequency: bill.frequency, nextDueAt: new Date(bill.nextDueAt).toISOString(), reminderDays: Number(bill.reminderDays), enabled: true }) });
      setBill((current) => ({ ...current, name: "", amount: "", merchant: "" })); setNotice("周期账单已启用"); await loadRecurring();
    } catch (error) { setNotice(error instanceof Error ? error.message : "创建周期账单失败"); }
  }
  const inputClass = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100";

  return <section className="surface-card overflow-hidden rounded-3xl">
    <div className="border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5 sm:p-6"><p className="text-xs font-black uppercase tracking-[.18em] text-amber-700">自动记账</p><h2 className="mt-2 text-xl font-black text-amber-950">订阅与固定支出</h2><p className="mt-2 text-sm text-amber-800">设置每周、每月或每年的固定账单，到期自动生成并提前提醒。</p></div>
    <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_.8fr] lg:p-6">
      <div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><input className={inputClass} value={bill.name} onChange={(event) => setBill({ ...bill, name: event.target.value })} placeholder="例如：视频会员" /><input className={inputClass} value={bill.amount} onChange={(event) => setBill({ ...bill, amount: event.target.value })} placeholder="金额（元）" /><select className={inputClass} value={bill.category} onChange={(event) => setBill({ ...bill, category: event.target.value as TransactionCategory })}>{transactionCategories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select><select className={inputClass} value={bill.accountId || activeAccounts[0]?.id || ""} onChange={(event) => setBill({ ...bill, accountId: event.target.value })}>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={inputClass} value={bill.frequency} onChange={(event) => setBill({ ...bill, frequency: event.target.value as typeof bill.frequency })}><option value="WEEKLY">每周</option><option value="MONTHLY">每月</option><option value="YEARLY">每年</option></select><input className={inputClass} type="datetime-local" value={bill.nextDueAt} onChange={(event) => setBill({ ...bill, nextDueAt: event.target.value })} /><input className={inputClass} value={bill.merchant} onChange={(event) => setBill({ ...bill, merchant: event.target.value })} placeholder="商家（可选）" /><label className="grid gap-1 text-xs font-semibold text-slate-600">提前提醒天数<input className={inputClass} type="number" min="0" max="30" value={bill.reminderDays} onChange={(event) => setBill({ ...bill, reminderDays: event.target.value })} /></label></div><button type="button" onClick={() => void addRecurring()} className="mt-4 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-800">启用周期账单</button></div>
      <div className="grid content-start gap-2">{recurring.length ? recurring.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-3 text-sm"><div><strong>{item.name}</strong><p className="mt-0.5 text-xs text-slate-500">{item.reminderDue ? `即将续费 · ${Math.max(item.daysUntilDue, 0)} 天后` : new Date(item.nextDueAt).toLocaleDateString("zh-CN")}{item.accountName ? ` · ${item.accountName}` : ""}</p></div><span className="font-black">¥{centsToYuan(item.amountCents)}</span></div>) : <p className="rounded-xl border border-dashed border-amber-200 p-5 text-center text-sm text-amber-800">还没有周期账单</p>}</div>
    </div>
    {notice && <p className="border-t border-amber-100 bg-amber-50/50 px-6 py-3 text-sm text-amber-900">{notice}</p>}
  </section>;
}
