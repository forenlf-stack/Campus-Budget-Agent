"use client";

import { useEffect, useMemo, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { mealPeriodLabels, mealPeriods, type MealCandidateInput, type MealPeriod } from "@/lib/meal-candidates";
import { centsToYuan, yuanToCents } from "@/lib/money";

interface Candidate extends Omit<MealCandidateInput, "priceUpdatedAt"> {
  id: string;
  priceUpdatedAt: string;
  lastPurchasedAt: string | null;
  dataSource: "MANUAL" | "SEED";
}

interface FormState {
  name: string;
  merchant: string;
  typicalPrice: string;
  location: string;
  mealPeriod: MealPeriod;
  tags: string;
  ingredients: string;
  isSpicy: boolean;
  userRating: string;
  enabled: boolean;
}

const emptyForm: FormState = { name: "", merchant: "", typicalPrice: "", location: "", mealPeriod: "LUNCH", tags: "", ingredients: "", isSpicy: false, userRating: "", enabled: true };
const inputClass = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100";

function splitList(value: string) {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function toInput(form: FormState): MealCandidateInput {
  return {
    name: form.name,
    merchant: form.merchant,
    typicalPriceCents: yuanToCents(form.typicalPrice),
    location: form.location,
    mealPeriod: form.mealPeriod,
    tags: splitList(form.tags),
    ingredients: splitList(form.ingredients),
    isSpicy: form.isSpicy,
    userRating: form.userRating ? Number(form.userRating) : null,
    priceUpdatedAt: new Date().toISOString(),
    enabled: form.enabled,
  };
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

export function MealCandidatesClient() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [mealPeriod, setMealPeriod] = useState("");
  const [enabled, setEnabled] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [disableId, setDisableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const query = useMemo(() => new URLSearchParams({ ...(location ? { location } : {}), ...(mealPeriod ? { mealPeriod } : {}), ...(enabled ? { enabled } : {}) }).toString(), [location, mealPeriod, enabled]);

  async function load() {
    setLoading(true);
    try {
      const data = await requestJson(`/api/meal-candidates?${query}`);
      setCandidates(data.candidates); setLocations(data.locations); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void requestJson(`/api/meal-candidates?${query}`).then((data) => {
      if (active) { setCandidates(data.candidates); setLocations(data.locations); setError(""); setLoading(false); }
    }).catch((caught: unknown) => {
      if (active) { setError(caught instanceof Error ? caught.message : "加载失败"); setLoading(false); }
    });
    return () => { active = false; };
  }, [query]);

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const input = toInput(form);
      await requestJson(editingId ? `/api/meal-candidates/${editingId}` : "/api/meal-candidates", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setMessage(editingId ? "餐食候选已更新。" : "餐食候选已添加。"); setEditingId(null); setForm(emptyForm); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  }

  function edit(item: Candidate) {
    setEditingId(item.id);
    setForm({ name: item.name, merchant: item.merchant, typicalPrice: centsToYuan(item.typicalPriceCents), location: item.location, mealPeriod: item.mealPeriod, tags: item.tags.join("，"), ingredients: item.ingredients.join("，"), isSpicy: item.isSpicy, userRating: item.userRating?.toString() ?? "", enabled: item.enabled });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function disable() {
    if (!disableId) return;
    try { await requestJson(`/api/meal-candidates/${disableId}`, { method: "DELETE" }); setMessage("餐食候选已停用，历史数据未删除。"); setDisableId(null); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "停用失败"); setDisableId(null); }
  }

  return (
    <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto grid max-w-6xl gap-6">
      <div><HomeLink /></div><header className="max-w-3xl py-2"><p className="page-kicker">个人资料库</p><h1 className="page-heading mt-4 text-4xl">个人餐饮候选库</h1><p className="mt-3 text-sm leading-7 text-slate-600">只维护你吃过或愿意选择的餐食；停用不会删除历史数据。</p></header>
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex justify-between"><h2 className="font-semibold">{editingId ? "编辑餐食" : "添加餐食"}</h2>{editingId && <button onClick={() => { setEditingId(null); setForm(emptyForm); }} className="text-sm text-slate-500">取消编辑</button>}</div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm">餐食名称<input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="grid gap-1 text-sm">商家或档口<input className={inputClass} value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} /></label>
        <label className="grid gap-1 text-sm">典型价格（元）<input className={inputClass} inputMode="decimal" value={form.typicalPrice} onChange={(event) => setForm({ ...form, typicalPrice: event.target.value })} /></label>
        <label className="grid gap-1 text-sm">地点<input className={inputClass} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
        <label className="grid gap-1 text-sm">时段<select className={inputClass} value={form.mealPeriod} onChange={(event) => setForm({ ...form, mealPeriod: event.target.value as MealPeriod })}>{mealPeriods.map((item) => <option key={item} value={item}>{mealPeriodLabels[item]}</option>)}</select></label>
        <label className="grid gap-1 text-sm">用户评分<select className={inputClass} value={form.userRating} onChange={(event) => setForm({ ...form, userRating: event.target.value })}><option value="">未评分</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>{item} 星</option>)}</select></label>
        <label className="grid gap-1 text-sm sm:col-span-2">标签（逗号分隔）<input className={inputClass} value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">食材（逗号分隔）<input className={inputClass} value={form.ingredients} onChange={(event) => setForm({ ...form, ingredients: event.target.value })} /></label>
      </div><div className="mt-4 flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.isSpicy} onChange={(event) => setForm({ ...form, isSpicy: event.target.checked })} />辣味</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用</label></div><button disabled={saving} onClick={() => void save()} className="mt-5 rounded-xl bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{saving ? "保存中…" : editingId ? "保存修改" : "添加餐食"}</button></section>
      {(error || message) && <div role="status" className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}
      <section className="rounded-2xl border border-stone-200 bg-white p-5"><div className="grid gap-4 sm:grid-cols-3"><label className="grid gap-1 text-sm">地点<select className={inputClass} value={location} onChange={(event) => setLocation(event.target.value)}><option value="">全部地点</option>{locations.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="grid gap-1 text-sm">时段<select className={inputClass} value={mealPeriod} onChange={(event) => setMealPeriod(event.target.value)}><option value="">全部时段</option>{mealPeriods.map((item) => <option key={item} value={item}>{mealPeriodLabels[item]}</option>)}</select></label><label className="grid gap-1 text-sm">状态<select className={inputClass} value={enabled} onChange={(event) => setEnabled(event.target.value)}><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select></label></div></section>
      {loading ? <div className="py-16 text-center text-sm text-slate-500">正在加载餐食候选…</div> : candidates.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 bg-white py-16 text-center text-sm text-slate-500">当前筛选条件下没有餐食候选</div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{candidates.map((item) => <article key={item.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${item.enabled ? "border-stone-200" : "border-slate-200 opacity-60"}`}><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{item.name}</h2><p className="mt-1 text-xs text-slate-500">{item.merchant} · {item.location}</p></div><span className="text-lg font-semibold text-orange-700">¥{centsToYuan(item.typicalPriceCents)}</span></div><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-orange-50 px-2 py-1 text-orange-800">{mealPeriodLabels[item.mealPeriod]}</span>{item.isSpicy && <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">辣</span>}<span className="rounded-full bg-slate-100 px-2 py-1">{item.enabled ? "已启用" : "已停用"}</span>{item.userRating && <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">{item.userRating} 星</span>}</div><p className="mt-4 text-xs text-slate-500">标签：{item.tags.join("、") || "无"}</p><p className="mt-2 text-xs text-slate-500">食材：{item.ingredients.join("、") || "未知"}</p><div className="mt-5 flex gap-4"><button onClick={() => edit(item)} className="text-sm text-orange-700">编辑</button>{item.enabled && <button onClick={() => setDisableId(item.id)} className="text-sm text-red-700">停用</button>}</div></article>)}</div>}
    </div>{disableId && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-sm rounded-2xl bg-white p-6"><h2 className="text-lg font-semibold">确认停用餐食？</h2><p className="mt-2 text-sm text-slate-600">停用后不再参与后续推荐，但不会删除餐食及历史数据。</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setDisableId(null)} className="rounded-xl border px-4 py-2 text-sm">取消</button><button onClick={() => void disable()} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">确认停用</button></div></div></div>}</main>
  );
}
