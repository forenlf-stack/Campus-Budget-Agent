"use client";

import { useEffect, useMemo, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { transactionCategories, transactionTypes, type TransactionCategory, type TransactionType } from "@/lib/budget";
import { centsToYuan, signedCentsToYuan, yuanToCents } from "@/lib/money";
import { categoryLabels } from "@/lib/settings";
import { groupTransactions, type TransactionGroup, type TransactionGroupKey, type TransactionGroupSort } from "@/lib/transaction-grouping";
import type { TransactionInput } from "@/lib/transactions";

interface RecordItem {
  id: string;
  type: TransactionType;
  category: TransactionCategory | null;
  amountCents: number;
  itemName: string;
  merchant: string | null;
  occurredAt: string;
  note: string | null;
  isFixedExpense: boolean;
  originalTransactionId: string | null;
}

function signedYuan(cents: number) {
  const value = signedCentsToYuan(cents);
  return value.startsWith("-") ? `-¥${value.slice(1)}` : `¥${value}`;
}

interface RefundableExpense { id: string; itemName: string; merchant: string | null; category: TransactionCategory; amountCents: number; refundableCents: number; isFixedExpense: number }
interface Payload {
  transactions: RecordItem[];
  refundableExpenses: RefundableExpense[];
  budget: { plannedVariableBudgetCents: number; netVariableSpendingCents: number; remainingBudgetCents: number; categories: Array<{ category: TransactionCategory; spentCents: number; refundedCents: number; netSpendingCents: number; remainingCents: number }> };
}

interface FormState {
  type: TransactionType;
  amount: string;
  category: TransactionCategory | "";
  itemName: string;
  merchant: string;
  occurredAt: string;
  note: string;
  isFixedExpense: boolean;
  originalTransactionId: string;
}

const typeLabels: Record<TransactionType, string> = { INCOME: "收入", EXPENSE: "支出", REFUND: "退款" };

const sortLabels: Record<TransactionGroupSort, string> = {
  AMOUNT_DESC: "金额：高到低",
  AMOUNT_ASC: "金额：低到高",
  TIME_DESC: "时间：最新优先",
  TIME_ASC: "时间：最早优先",
  FIXED_FIRST: "固定支出优先",
  MERCHANT_ASC: "商家名称排序",
};

const groupVisuals: Record<TransactionGroupKey, { icon: string; iconClass: string; barClass: string }> = {
  MEAL: { icon: "餐", iconClass: "bg-orange-100 text-orange-700", barClass: "bg-orange-500" },
  SNACK_DRINK: { icon: "饮", iconClass: "bg-pink-100 text-pink-700", barClass: "bg-pink-500" },
  DAILY_NECESSITY: { icon: "日", iconClass: "bg-cyan-100 text-cyan-700", barClass: "bg-cyan-500" },
  STUDY: { icon: "学", iconClass: "bg-indigo-100 text-indigo-700", barClass: "bg-indigo-500" },
  TRANSPORT: { icon: "行", iconClass: "bg-sky-100 text-sky-700", barClass: "bg-sky-500" },
  GAME_ENTERTAINMENT: { icon: "娱", iconClass: "bg-violet-100 text-violet-700", barClass: "bg-violet-500" },
  RECHARGE_SUBSCRIPTION: { icon: "充", iconClass: "bg-blue-100 text-blue-700", barClass: "bg-blue-500" },
  MEDICAL: { icon: "医", iconClass: "bg-rose-100 text-rose-700", barClass: "bg-rose-500" },
  OTHER: { icon: "其", iconClass: "bg-slate-100 text-slate-700", barClass: "bg-slate-500" },
  INCOME: { icon: "收", iconClass: "bg-emerald-100 text-emerald-700", barClass: "bg-emerald-500" },
};

function groupLabel(key: TransactionGroupKey) {
  return key === "INCOME" ? "收入" : categoryLabels[key];
}

function localDateTime(iso = new Date().toISOString()) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function emptyForm(): FormState {
  return { type: "EXPENSE", amount: "", category: "MEAL", itemName: "", merchant: "", occurredAt: localDateTime(), note: "", isFixedExpense: false, originalTransactionId: "" };
}

function toInput(form: FormState): TransactionInput {
  return {
    type: form.type,
    amountCents: yuanToCents(form.amount),
    category: form.type === "INCOME" ? null : form.category || null,
    itemName: form.itemName,
    merchant: form.merchant,
    occurredAt: new Date(form.occurredAt).toISOString(),
    note: form.note,
    isFixedExpense: form.type === "INCOME" ? false : form.isFixedExpense,
    originalTransactionId: form.type === "REFUND" ? form.originalTransactionId || null : null,
  };
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

function TransactionForm({ form, setForm, refundableExpenses, onSubmit, onCancel, saving, editing }: { form: FormState; setForm: (form: FormState) => void; refundableExpenses: RefundableExpense[]; onSubmit: () => void; onCancel: () => void; saving: boolean; editing: boolean }) {
  const inputClass = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
  const selectedOriginal = refundableExpenses.find((item) => item.id === form.originalTransactionId);
  const matchingRefundableExpenses = refundableExpenses.filter((item) => !form.category || item.category === form.category);
  return (
    <div className="surface-card grid gap-4 rounded-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? "编辑记录" : "添加记录"}</h2>{editing && <button type="button" onClick={onCancel} className="text-sm text-slate-500">取消编辑</button>}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-sm">类型<select className={inputClass} value={form.type} onChange={(event) => { const type = event.target.value as TransactionType; setForm({ ...form, type, category: type === "INCOME" ? "" : form.category || "MEAL", originalTransactionId: "", isFixedExpense: type === "INCOME" ? false : form.isFixedExpense }); }}>{transactionTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm">金额（元）<input className={inputClass} inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="例如 13.00" /></label>
        {form.type !== "INCOME" && <label className="grid gap-1.5 text-sm">分类<select className={inputClass} value={form.category} onChange={(event) => { const nextCategory = event.target.value as TransactionCategory; setForm({ ...form, category: nextCategory, ...(form.type === "REFUND" ? { originalTransactionId: "", amount: "", itemName: "", merchant: "", isFixedExpense: false } : {}) }); }}>{transactionCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>}
        {form.type === "REFUND" && <label className="grid gap-1.5 text-sm">原支出<select className={inputClass} value={form.originalTransactionId} onChange={(event) => { const original = refundableExpenses.find((item) => item.id === event.target.value); setForm({ ...form, originalTransactionId: event.target.value, category: original?.category ?? form.category, amount: original ? centsToYuan(original.refundableCents) : form.amount, itemName: original ? `${original.itemName}退款` : form.itemName, merchant: original?.merchant ?? form.merchant, isFixedExpense: Boolean(original?.isFixedExpense) }); }}><option value="">请选择{form.category ? `属于${categoryLabels[form.category]}` : ""}的支出</option>{matchingRefundableExpenses.map((item) => <option key={item.id} value={item.id}>{item.itemName}（可退 ¥{centsToYuan(item.refundableCents)}）</option>)}</select></label>}
        <label className="grid gap-1.5 text-sm">商品或项目名称<input className={inputClass} value={form.itemName} onChange={(event) => setForm({ ...form, itemName: event.target.value })} /></label>
        <label className="grid gap-1.5 text-sm">商家<input className={inputClass} value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} /></label>
        <label className="grid gap-1.5 text-sm">发生时间<input className={inputClass} type="datetime-local" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} /></label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">备注<input className={inputClass} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
      </div>
      {form.type !== "INCOME" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isFixedExpense} disabled={form.type === "REFUND" && Boolean(selectedOriginal)} onChange={(event) => setForm({ ...form, isFixedExpense: event.target.checked })} />是否为固定支出</label>}
      <button type="button" disabled={saving} onClick={onSubmit} className="justify-self-start rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{saving ? "保存中…" : editing ? "保存修改" : "添加记录"}</button>
    </div>
  );
}

function TransactionGroupCard({ group, sort, totalNetCents, onSortChange, onEdit, onDelete }: {
  group: TransactionGroup<RecordItem>;
  sort: TransactionGroupSort;
  totalNetCents: number;
  onSortChange: (sort: TransactionGroupSort) => void;
  onEdit: (item: RecordItem) => void;
  onDelete: (id: string) => void;
}) {
  const label = groupLabel(group.key);
  const visual = groupVisuals[group.key];
  const sharePercent = group.key === "INCOME" || totalNetCents <= 0 ? 0 : Math.max(0, Math.round((group.netCents / totalNetCents) * 100));
  const typeTone: Record<TransactionType, string> = {
    INCOME: "bg-emerald-50 text-emerald-700",
    EXPENSE: "bg-amber-50 text-amber-700",
    REFUND: "bg-blue-50 text-blue-700",
  };

  return (
    <section id={`group-${group.key.toLowerCase()}`} className="surface-card scroll-mt-6 overflow-hidden rounded-3xl">
      <div className="border-b border-slate-100 bg-gradient-to-r from-white via-white to-slate-50/80 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-black ${visual.iconClass}`} aria-hidden="true">{visual.icon}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-950">{label}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{group.items.length} 笔</span>
                {sharePercent > 0 && <span className="text-xs font-medium text-slate-500">占分类净支出 {sharePercent}%</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">类别按净金额聚合，类别内可独立调整排序。</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
            {group.key === "INCOME" ? (
              <div className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-right">
                <p className="text-[11px] font-medium text-emerald-700">收入合计</p>
                <p className="mt-0.5 font-black text-emerald-800">¥{centsToYuan(group.incomeCents)}</p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-right">
                  <p className="text-[11px] font-medium text-slate-500">支出</p>
                  <p className="mt-0.5 font-black text-slate-800">¥{centsToYuan(group.expenseCents)}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-2.5 text-right">
                  <p className="text-[11px] font-medium text-blue-600">退款</p>
                  <p className="mt-0.5 font-black text-blue-700">¥{centsToYuan(group.refundCents)}</p>
                </div>
                <div className="rounded-2xl bg-teal-50 px-4 py-2.5 text-right">
                  <p className="text-[11px] font-medium text-teal-600">净支出</p>
                  <p className="mt-0.5 font-black text-teal-800">{signedYuan(group.netCents)}</p>
                </div>
              </>
            )}
            <label className="col-span-2 grid gap-1 text-xs font-semibold text-slate-600 sm:min-w-44">
              类别内排序
              <select
                aria-label={`${label}类别内排序`}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                value={sort}
                onChange={(event) => onSortChange(event.target.value as TransactionGroupSort)}
              >
                {Object.entries(sortLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
          </div>
        </div>

        {group.key !== "INCOME" && totalNetCents > 0 && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`${label}占净支出${sharePercent}%`}>
            <div className={`h-full rounded-full ${visual.barClass}`} style={{ width: `${Math.min(sharePercent, 100)}%` }} />
          </div>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {group.items.map((item) => (
          <article key={item.id} className="grid gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${typeTone[item.type]}`}>{typeLabels[item.type]}</span>
                {item.isFixedExpense && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">固定支出</span>}
                <time className="text-xs text-slate-400" dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <h3 className="mt-2 truncate font-bold text-slate-900">{item.itemName}</h3>
              <p className="mt-1 truncate text-xs text-slate-500">{item.merchant || "未填写商家"}{item.note ? ` · ${item.note}` : ""}</p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <p className={`whitespace-nowrap text-lg font-black ${item.type === "EXPENSE" ? "text-slate-950" : "text-teal-700"}`}>{item.type === "EXPENSE" ? "−" : "+"}¥{centsToYuan(item.amountCents)}</p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => onEdit(item)} className="rounded-lg px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50">编辑</button>
                <button type="button" onClick={() => onDelete(item.id)} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">删除</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TransactionsClient() {
  const [period, setPeriod] = useState("2026-07");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sortByGroup, setSortByGroup] = useState<Partial<Record<TransactionGroupKey, TransactionGroupSort>>>({});

  const query = useMemo(() => new URLSearchParams({ period, ...(category ? { category } : {}), ...(type ? { type } : {}) }).toString(), [period, category, type]);
  const groupedTransactions = useMemo(() => groupTransactions(data?.transactions ?? [], sortByGroup), [data?.transactions, sortByGroup]);
  const totalGroupedNetCents = useMemo(() => groupedTransactions.reduce((total, group) => group.key === "INCOME" ? total : total + Math.max(group.netCents, 0), 0), [groupedTransactions]);
  async function load() { setLoading(true); setError(""); try { setData(await requestJson(`/api/transactions?${query}`)); } catch (caught) { setError(caught instanceof Error ? caught.message : "加载失败"); } finally { setLoading(false); } }
  useEffect(() => { let active = true; void requestJson(`/api/transactions?${query}`).then((result) => { if (active) { setData(result); setError(""); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : "加载失败"); setLoading(false); } }); return () => { active = false; }; }, [query]);

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      if (!form.amount.trim()) throw new Error("请输入金额");
      if (form.type === "REFUND" && !form.originalTransactionId) throw new Error("请选择要退款的原支出");
      const input = toInput(form);
      await requestJson(editingId ? `/api/transactions/${editingId}` : "/api/transactions", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setForm(emptyForm()); setEditingId(null); setMessage(editingId ? "记录已更新，预算已重新计算。" : "记录已添加，预算已重新计算。"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); }
  }

  function edit(item: RecordItem) { setEditingId(item.id); setForm({ type: item.type, amount: centsToYuan(item.amountCents), category: item.category ?? "", itemName: item.itemName, merchant: item.merchant ?? "", occurredAt: localDateTime(item.occurredAt), note: item.note ?? "", isFixedExpense: item.isFixedExpense, originalTransactionId: item.originalTransactionId ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function remove() { if (!deleteId) return; try { await requestJson(`/api/transactions/${deleteId}`, { method: "DELETE" }); setDeleteId(null); setMessage("记录已删除，预算已重新计算。"); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败"); setDeleteId(null); } }

  return (
    <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto grid max-w-6xl gap-6">
      <div><HomeLink /></div><header className="max-w-3xl py-2"><p className="page-kicker">分类账本</p><h1 className="page-heading mt-4 text-4xl">消费记录</h1><p className="mt-3 text-sm leading-7 text-slate-600">记录按消费类别聚合展示，优先看清钱花在了哪里；每个类别都可以使用自己的排序方式。</p></header>
      <TransactionForm form={form} setForm={setForm} refundableExpenses={data?.refundableExpenses ?? []} onSubmit={() => void save()} onCancel={() => { setEditingId(null); setForm(emptyForm()); }} saving={saving} editing={Boolean(editingId)} />
      {(error || message) && <div role="status" className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}
      {data && <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-3xl bg-gradient-to-br from-slate-950 to-indigo-950 p-5 text-white shadow-lg shadow-indigo-950/10"><p className="text-xs text-slate-400">本月总消费预算</p><p className="mt-1 text-2xl font-black">¥{centsToYuan(data.budget.plannedVariableBudgetCents)}</p></div><div className="surface-card rounded-3xl p-5"><p className="text-xs text-slate-500">实际净支出</p><p className="mt-1 text-2xl font-black">{signedYuan(data.budget.netVariableSpendingCents)}</p></div><div className="surface-card rounded-3xl p-5"><p className="text-xs text-slate-500">总预算剩余</p><p className={`mt-1 text-2xl font-black ${data.budget.remainingBudgetCents < 0 ? "text-red-700" : "text-teal-700"}`}>{signedYuan(data.budget.remainingBudgetCents)}</p></div></div>}
      <section className="surface-card rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-black text-slate-950">分类账本</h2><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">按净支出排列类别</span></div>
            <p className="mt-1 text-xs leading-5 text-slate-500">默认先显示每类金额较高的条目，不再把不同类别混在一条时间线中。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">预算周期<input type="month" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">筛选分类<select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{transactionCategories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">资金类型<select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option>{transactionTypes.map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>
          </div>
        </div>
        {(category || type) && <button type="button" onClick={() => { setCategory(""); setType(""); }} className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">清除筛选</button>}
      </section>

      {!loading && groupedTransactions.length > 1 && (
        <nav aria-label="消费类别快速导航" className="data-scroll flex gap-2 overflow-x-auto pb-1">
          {groupedTransactions.map((group) => <a key={group.key} href={`#group-${group.key.toLowerCase()}`} className="flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white/85 px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm backdrop-blur hover:border-indigo-200 hover:text-indigo-700"><span className={`grid size-6 place-items-center rounded-lg text-[10px] ${groupVisuals[group.key].iconClass}`}>{groupVisuals[group.key].icon}</span>{groupLabel(group.key)}<span className="text-slate-400">{group.items.length}</span></a>)}
        </nav>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">正在加载消费记录…</div>
      ) : !groupedTransactions.length ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 py-16 text-center"><p className="font-bold text-slate-800">当前筛选条件下没有记录</p><p className="mt-2 text-sm text-slate-500">可使用上方表单添加第一条记录。</p></div>
      ) : (
        <div className="grid gap-5">
          {groupedTransactions.map((group) => (
            <TransactionGroupCard
              key={group.key}
              group={group}
              sort={sortByGroup[group.key] ?? "AMOUNT_DESC"}
              totalNetCents={totalGroupedNetCents}
              onSortChange={(sort) => setSortByGroup((current) => ({ ...current, [group.key]: sort }))}
              onEdit={edit}
              onDelete={setDeleteId}
            />
          ))}
        </div>
      )}
    </div>
    {deleteId && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"><h2 id="delete-title" className="text-lg font-semibold">确认删除记录？</h2><p className="mt-2 text-sm text-slate-600">删除后无法恢复，预算数据会立即重新计算。</p><div className="mt-6 flex justify-end gap-3"><button autoFocus onClick={() => setDeleteId(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">取消</button><button onClick={() => void remove()} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">确认删除</button></div></div></div>}
    </main>
  );
}
