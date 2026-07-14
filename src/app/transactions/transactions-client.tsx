"use client";

import { useEffect, useMemo, useState } from "react";

import { transactionCategories, transactionTypes, type TransactionCategory, type TransactionType } from "@/lib/budget";
import { centsToYuan, yuanToCents } from "@/lib/money";
import { categoryLabels } from "@/lib/settings";
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

interface RefundableExpense { id: string; itemName: string; category: TransactionCategory; amountCents: number; refundableCents: number; isFixedExpense: number }
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
  return (
    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? "编辑记录" : "添加记录"}</h2>{editing && <button type="button" onClick={onCancel} className="text-sm text-slate-500">取消编辑</button>}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-sm">类型<select className={inputClass} value={form.type} onChange={(event) => { const type = event.target.value as TransactionType; setForm({ ...form, type, category: type === "INCOME" ? "" : form.category || "MEAL", originalTransactionId: "", isFixedExpense: type === "INCOME" ? false : form.isFixedExpense }); }}>{transactionTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm">金额（元）<input className={inputClass} inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="例如 13.00" /></label>
        {form.type !== "INCOME" && <label className="grid gap-1.5 text-sm">分类<select className={inputClass} value={form.category} disabled={form.type === "REFUND" && Boolean(selectedOriginal)} onChange={(event) => setForm({ ...form, category: event.target.value as TransactionCategory })}>{transactionCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>}
        {form.type === "REFUND" && <label className="grid gap-1.5 text-sm">原支出<select className={inputClass} value={form.originalTransactionId} onChange={(event) => { const original = refundableExpenses.find((item) => item.id === event.target.value); setForm({ ...form, originalTransactionId: event.target.value, category: original?.category ?? form.category, isFixedExpense: Boolean(original?.isFixedExpense) }); }}><option value="">请选择</option>{refundableExpenses.map((item) => <option key={item.id} value={item.id}>{item.itemName}（可退 ¥{centsToYuan(item.refundableCents)}）</option>)}</select></label>}
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

  const query = useMemo(() => new URLSearchParams({ period, ...(category ? { category } : {}), ...(type ? { type } : {}) }).toString(), [period, category, type]);
  async function load() { setLoading(true); setError(""); try { setData(await requestJson(`/api/transactions?${query}`)); } catch (caught) { setError(caught instanceof Error ? caught.message : "加载失败"); } finally { setLoading(false); } }
  useEffect(() => { let active = true; void requestJson(`/api/transactions?${query}`).then((result) => { if (active) { setData(result); setError(""); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : "加载失败"); setLoading(false); } }); return () => { active = false; }; }, [query]);

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const input = toInput(form);
      await requestJson(editingId ? `/api/transactions/${editingId}` : "/api/transactions", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setForm(emptyForm()); setEditingId(null); setMessage(editingId ? "记录已更新，预算已重新计算。" : "记录已添加，预算已重新计算。"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); }
  }

  function edit(item: RecordItem) { setEditingId(item.id); setForm({ type: item.type, amount: centsToYuan(item.amountCents), category: item.category ?? "", itemName: item.itemName, merchant: item.merchant ?? "", occurredAt: localDateTime(item.occurredAt), note: item.note ?? "", isFixedExpense: item.isFixedExpense, originalTransactionId: item.originalTransactionId ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function remove() { if (!deleteId) return; try { await requestJson(`/api/transactions/${deleteId}`, { method: "DELETE" }); setDeleteId(null); setMessage("记录已删除，预算已重新计算。"); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败"); setDeleteId(null); } }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6"><div className="mx-auto grid max-w-6xl gap-6">
      <header><p className="text-sm font-semibold text-teal-700">手工记账</p><h1 className="mt-2 text-3xl font-bold">消费记录</h1><p className="mt-2 text-sm text-slate-600">收入、支出和退款均使用正金额，资金方向由类型表达。</p></header>
      <TransactionForm form={form} setForm={setForm} refundableExpenses={data?.refundableExpenses ?? []} onSubmit={() => void save()} onCancel={() => { setEditingId(null); setForm(emptyForm()); }} saving={saving} editing={Boolean(editingId)} />
      {(error || message) && <div role="status" className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}
      {data && <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-slate-900 p-5 text-white"><p className="text-xs text-slate-400">计划可变预算</p><p className="mt-1 text-2xl font-semibold">¥{centsToYuan(data.budget.plannedVariableBudgetCents)}</p></div><div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">实际可变净支出</p><p className="mt-1 text-2xl font-semibold">¥{centsToYuan(data.budget.netVariableSpendingCents)}</p></div><div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">总剩余预算</p><p className={`mt-1 text-2xl font-semibold ${data.budget.remainingBudgetCents < 0 ? "text-red-700" : "text-teal-700"}`}>¥{(data.budget.remainingBudgetCents / 100).toFixed(2)}</p></div></div>}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><label className="grid gap-1 text-sm">预算周期<input type="month" className="rounded-xl border border-slate-200 px-3 py-2" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><label className="grid gap-1 text-sm">分类<select className="rounded-xl border border-slate-200 px-3 py-2" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部</option>{transactionCategories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label><label className="grid gap-1 text-sm">类型<select className="rounded-xl border border-slate-200 px-3 py-2" value={type} onChange={(event) => setType(event.target.value)}><option value="">全部</option>{transactionTypes.map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label></div></section>
      {loading ? <div className="py-16 text-center text-sm text-slate-500">正在加载消费记录…</div> : !data?.transactions.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center"><p className="font-medium">当前筛选条件下没有记录</p><p className="mt-2 text-sm text-slate-500">可使用上方表单添加第一条记录。</p></div> : <div className="grid gap-3">{data.transactions.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.type === "INCOME" ? "bg-emerald-100 text-emerald-800" : item.type === "REFUND" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{typeLabels[item.type]}</span>{item.category && <span className="text-xs text-slate-500">{categoryLabels[item.category]}</span>}{item.isFixedExpense && <span className="text-xs text-slate-500">固定支出</span>}</div><h2 className="mt-2 font-semibold">{item.itemName}</h2><p className="mt-1 text-xs text-slate-500">{item.merchant || "无商家"} · {new Date(item.occurredAt).toLocaleString("zh-CN")}</p></div><div className="flex items-center gap-4"><p className={`text-lg font-semibold ${item.type === "EXPENSE" ? "text-slate-900" : "text-teal-700"}`}>{item.type === "EXPENSE" ? "-" : "+"}¥{centsToYuan(item.amountCents)}</p><button onClick={() => edit(item)} className="text-sm text-teal-700">编辑</button><button onClick={() => setDeleteId(item.id)} className="text-sm text-red-700">删除</button></div></article>)}</div>}
      {data && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">分类预算使用</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.budget.categories.map((item) => <div key={item.category} className="rounded-xl bg-slate-50 p-4"><div className="flex justify-between text-sm"><span>{categoryLabels[item.category]}</span><span>净支出 ¥{centsToYuan(item.netSpendingCents)}</span></div><p className="mt-2 text-xs text-slate-500">消费 ¥{centsToYuan(item.spentCents)} · 退款 ¥{centsToYuan(item.refundedCents)} · 剩余 ¥{(item.remainingCents / 100).toFixed(2)}</p></div>)}</div></section>}
    </div>
    {deleteId && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"><h2 id="delete-title" className="text-lg font-semibold">确认删除记录？</h2><p className="mt-2 text-sm text-slate-600">删除后无法恢复，预算数据会立即重新计算。</p><div className="mt-6 flex justify-end gap-3"><button autoFocus onClick={() => setDeleteId(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">取消</button><button onClick={() => void remove()} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">确认删除</button></div></div></div>}
    </main>
  );
}
