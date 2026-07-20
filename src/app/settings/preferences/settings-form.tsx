"use client";

import { useEffect, useMemo, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { transactionCategories } from "@/lib/budget";
import { centsToYuan, yuanToCents } from "@/lib/money";
import { calculateSettingsSummary, categoryLabels, settingsSchema, type SettingsInput } from "@/lib/settings";

type AmountKey =
  | "monthlyAllowanceCents"
  | "currentBalanceCents"
  | "fixedExpenseCents"
  | "monthlySavingsTargetCents"
  | "requiredReserveCents"
  | "totalBudgetCents"
  | "recommendedLunchPriceCents"
  | "lunchHardLimitCents"
  | "weeklySnackDrinkBudgetCents"
  | "shoppingReminderThresholdCents";

type FormState = Omit<SettingsInput, AmountKey | "foodLikes" | "foodDislikes" | "foodAllergens"> & {
  amounts: Record<AmountKey, string>;
  foodLikes: string;
  foodDislikes: string;
  foodAllergens: string;
};

const amountFields: Array<{ key: AmountKey; label: string }> = [
  { key: "monthlyAllowanceCents", label: "月生活费" },
  { key: "currentBalanceCents", label: "当前可用余额" },
  { key: "fixedExpenseCents", label: "固定支出" },
  { key: "monthlySavingsTargetCents", label: "每月储蓄目标" },
  { key: "requiredReserveCents", label: "必要预留资金" },
];

function splitList(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function toFormState(data: SettingsInput): FormState {
  const amountKeys: AmountKey[] = [
    "monthlyAllowanceCents",
    "currentBalanceCents",
    "fixedExpenseCents",
    "monthlySavingsTargetCents",
    "requiredReserveCents",
    "totalBudgetCents",
    "recommendedLunchPriceCents",
    "lunchHardLimitCents",
    "weeklySnackDrinkBudgetCents",
    "shoppingReminderThresholdCents",
  ];
  return {
    period: data.period,
    allowanceDay: data.allowanceDay,
    defaultLocation: data.defaultLocation,
    weeklySnackDrinkLimit: data.weeklySnackDrinkLimit,
    coolingOffHours: data.coolingOffHours,
    protectedCategories: data.protectedCategories,
    amounts: Object.fromEntries(amountKeys.map((key) => [key, centsToYuan(data[key])])) as Record<AmountKey, string>,
    foodLikes: data.foodLikes.join("，"),
    foodDislikes: data.foodDislikes.join("，"),
    foodAllergens: data.foodAllergens.join("，"),
  };
}

function toSettingsInput(form: FormState): SettingsInput {
  return {
    period: form.period,
    monthlyAllowanceCents: yuanToCents(form.amounts.monthlyAllowanceCents),
    currentBalanceCents: yuanToCents(form.amounts.currentBalanceCents),
    fixedExpenseCents: yuanToCents(form.amounts.fixedExpenseCents),
    monthlySavingsTargetCents: yuanToCents(form.amounts.monthlySavingsTargetCents),
    requiredReserveCents: yuanToCents(form.amounts.requiredReserveCents),
    totalBudgetCents: yuanToCents(form.amounts.totalBudgetCents),
    allowanceDay: form.allowanceDay,
    defaultLocation: form.defaultLocation,
    recommendedLunchPriceCents: yuanToCents(form.amounts.recommendedLunchPriceCents),
    lunchHardLimitCents: yuanToCents(form.amounts.lunchHardLimitCents),
    weeklySnackDrinkLimit: form.weeklySnackDrinkLimit,
    weeklySnackDrinkBudgetCents: yuanToCents(form.amounts.weeklySnackDrinkBudgetCents),
    shoppingReminderThresholdCents: yuanToCents(form.amounts.shoppingReminderThresholdCents),
    coolingOffHours: form.coolingOffHours,
    foodLikes: splitList(form.foodLikes),
    foodDislikes: splitList(form.foodDislikes),
    foodAllergens: splitList(form.foodAllergens),
    protectedCategories: form.protectedCategories,
  };
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <span className="flex overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-100">
        <input className="min-w-0 flex-1 px-4 py-3 outline-none" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="grid place-items-center border-l border-slate-200 bg-slate-50 px-3 text-slate-500">元</span>
      </span>
    </label>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card rounded-3xl p-5 sm:p-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-gradient-to-br from-teal-700 to-emerald-500 text-sm font-bold text-white shadow-sm">{number}</span>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

async function fetchSettings(): Promise<SettingsInput> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "加载配置失败");
  return payload.data;
}

export function SettingsForm() {
  const [form, setForm] = useState<FormState | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoadingError("");
    try {
      setForm(toFormState(await fetchSettings()));
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : "加载配置失败");
    }
  }

  useEffect(() => {
    let active = true;
    void fetchSettings()
      .then((data) => {
        if (active) setForm(toFormState(data));
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(error instanceof Error ? error.message : "加载配置失败");
      });
    return () => { active = false; };
  }, []);

  const evaluation = useMemo(() => {
    if (!form) return null;
    try {
      const input = toSettingsInput(form);
      const result = settingsSchema.safeParse(input);
      const summary = calculateSettingsSummary(input);
      return {
        input,
        summary,
        valid: result.success,
        reason: result.success ? "" : result.error.issues[0]?.message ?? "配置不可行",
      };
    } catch (error) {
      return { input: null, summary: null, valid: false, reason: error instanceof Error ? error.message : "请输入有效金额" };
    }
  }, [form]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!evaluation?.valid || !evaluation.input) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evaluation.input),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "保存失败");
      setForm(toFormState(payload.data));
      setMessage({ type: "success", text: "配置已保存，刷新页面后仍会保留。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  if (loadingError) {
    return <main className="app-page p-6"><HomeLink /><div className="surface-card mx-auto mt-16 max-w-md rounded-3xl p-8 text-center"><h1 className="text-xl font-bold">配置加载失败</h1><p className="mt-3 text-sm text-red-700">{loadingError}</p><button onClick={() => void load()} className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white">重新加载</button></div></main>;
  }
  if (!form) {
    return <main className="app-page p-6"><HomeLink /><p className="mt-24 text-center text-sm text-slate-500">正在加载资金与偏好配置…</p></main>;
  }

  const updateAmount = (key: AmountKey, value: string) => setForm({ ...form, amounts: { ...form.amounts, [key]: value } });
  const summary = evaluation?.summary;

  return (
    <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10">
      <form onSubmit={submit} className="relative mx-auto grid max-w-5xl gap-6 pb-28 sm:pb-20">
        <div><HomeLink /></div>
        <header className="mb-2 max-w-3xl py-2">
          <p className="page-kicker">个人配置</p>
          <h1 className="page-heading mt-4 text-4xl">资金与偏好设置</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">只需设置本月总消费预算；每笔支出仍选择分类，用于后续统计消费结构。</p>
        </header>

        <Section number="1" title="资金背景">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {amountFields.map((field) => <MoneyField key={field.key} label={field.label} value={form.amounts[field.key]} onChange={(value) => updateAmount(field.key, value)} />)}
            <label className="grid gap-2 text-sm font-medium text-slate-700">生活费发放日<input className="rounded-xl border border-slate-200 px-4 py-3" type="number" min="1" max="31" value={form.allowanceDay} onChange={(event) => setForm({ ...form, allowanceDay: Number(event.target.value) })} /></label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">默认地点<input className="rounded-xl border border-slate-200 px-4 py-3" value={form.defaultLocation} onChange={(event) => setForm({ ...form, defaultLocation: event.target.value })} placeholder="例如：学校东区" /></label>
          </div>
        </Section>

        <Section number="2" title="总消费预算">
          <div className="max-w-md">
            <MoneyField label="本月总消费预算" value={form.amounts.totalBudgetCents} onChange={(value) => updateAmount("totalBudgetCents", value)} />
          </div>
          <p className="mt-3 text-sm text-slate-500">无需提前为各分类分配额度。分类在记账时选择，首页将按实际支出展示占比。</p>
          <div className="mt-6 grid gap-3 rounded-2xl bg-slate-900 p-5 text-white sm:grid-cols-3">
            {[
              ["本月总消费预算", summary?.totalBudgetCents],
              ["扣除计划后可用", summary?.availableAfterPlansCents],
              ["未纳入预算金额", summary?.unbudgetedCents],
            ].map(([label, value]) => <div key={String(label)}><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold">{typeof value === "number" ? `¥${(value / 100).toFixed(2)}` : "—"}</p></div>)}
          </div>
        </Section>

        <Section number="3" title="消费偏好">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <MoneyField label="午餐建议价格" value={form.amounts.recommendedLunchPriceCents} onChange={(value) => updateAmount("recommendedLunchPriceCents", value)} />
            <MoneyField label="午餐硬上限" value={form.amounts.lunchHardLimitCents} onChange={(value) => updateAmount("lunchHardLimitCents", value)} />
            <label className="grid gap-2 text-sm font-medium text-slate-700">零食饮料每周次数上限<input className="rounded-xl border border-slate-200 px-4 py-3" type="number" min="0" max="100" value={form.weeklySnackDrinkLimit} onChange={(event) => setForm({ ...form, weeklySnackDrinkLimit: Number(event.target.value) })} /></label>
            <MoneyField label="零食饮料每周预算" value={form.amounts.weeklySnackDrinkBudgetCents} onChange={(value) => updateAmount("weeklySnackDrinkBudgetCents", value)} />
            <MoneyField label="单笔购物提醒金额" value={form.amounts.shoppingReminderThresholdCents} onChange={(value) => updateAmount("shoppingReminderThresholdCents", value)} />
            <label className="grid gap-2 text-sm font-medium text-slate-700">冷静期小时数<input className="rounded-xl border border-slate-200 px-4 py-3" type="number" min="0" max="720" value={form.coolingOffHours} onChange={(event) => setForm({ ...form, coolingOffHours: Number(event.target.value) })} /></label>
          </div>
        </Section>

        <Section number="4" title="饮食偏好">
          <div className="grid gap-5 md:grid-cols-3">
            {(["foodLikes", "foodDislikes", "foodAllergens"] as const).map((key) => <label key={key} className="grid gap-2 text-sm font-medium text-slate-700">{{ foodLikes: "喜欢", foodDislikes: "不喜欢", foodAllergens: "过敏或严格忌口" }[key]}<textarea className="min-h-28 rounded-xl border border-slate-200 px-4 py-3" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder="使用逗号或换行分隔" /></label>)}
          </div>
          <fieldset className="mt-6"><legend className="text-sm font-medium text-slate-700">不允许优先削减的类别</legend><div className="mt-3 flex flex-wrap gap-2">{transactionCategories.map((category) => { const selected = form.protectedCategories.includes(category); return <label key={category} className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${selected ? "border-teal-700 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600"}`}><input className="sr-only" type="checkbox" checked={selected} onChange={() => setForm({ ...form, protectedCategories: selected ? form.protectedCategories.filter((item) => item !== category) : [...form.protectedCategories, category] })} />{categoryLabels[category]}</label>; })}</div></fieldset>
        </Section>

        <div className="safe-sticky-action sticky z-20 flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-[0_18px_45px_rgba(30,41,59,0.18)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div aria-live="polite" className={`text-sm ${evaluation?.valid ? "text-slate-600" : "font-medium text-red-700"}`}>{message?.text ?? (evaluation?.valid ? "配置可保存" : evaluation?.reason)}</div>
          <button disabled={!evaluation?.valid || saving} className="rounded-xl bg-gradient-to-r from-teal-700 to-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-teal-700/10 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-300">{saving ? "保存中…" : "保存配置"}</button>
        </div>
        {message && <div role="status" className={`rounded-xl border p-4 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message.text}</div>}
      </form>
    </main>
  );
}
