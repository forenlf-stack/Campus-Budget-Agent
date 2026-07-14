"use client";

import { useEffect, useMemo, useState } from "react";

import { transactionCategories, type TransactionCategory } from "@/lib/budget";
import { centsToYuan, yuanToCents } from "@/lib/money";
import { calculateSettingsSummary, categoryLabels, settingsSchema, type SettingsInput } from "@/lib/settings";

type AmountKey =
  | "monthlyAllowanceCents"
  | "currentBalanceCents"
  | "fixedExpenseCents"
  | "monthlySavingsTargetCents"
  | "requiredReserveCents"
  | "recommendedLunchPriceCents"
  | "lunchHardLimitCents"
  | "weeklySnackDrinkBudgetCents"
  | "shoppingReminderThresholdCents";

type FormState = Omit<SettingsInput, AmountKey | "categoryBudgets" | "foodLikes" | "foodDislikes" | "foodAllergens"> & {
  amounts: Record<AmountKey, string>;
  categoryBudgets: Record<TransactionCategory, string>;
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
    categoryBudgets: Object.fromEntries(transactionCategories.map((category) => [
      category,
      centsToYuan(data.categoryBudgets.find((item) => item.category === category)?.budgetCents ?? 0),
    ])) as Record<TransactionCategory, string>,
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
    allowanceDay: form.allowanceDay,
    defaultLocation: form.defaultLocation,
    categoryBudgets: transactionCategories.map((category) => ({ category, budgetCents: yuanToCents(form.categoryBudgets[category]) })),
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
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-teal-700 text-sm font-semibold text-white">{number}</span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
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
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center"><h1 className="text-xl font-semibold">配置加载失败</h1><p className="mt-3 text-sm text-red-700">{loadingError}</p><button onClick={() => void load()} className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white">重新加载</button></div></main>;
  }
  if (!form) {
    return <main className="grid min-h-screen place-items-center bg-slate-50"><p className="animate-pulse text-sm text-slate-500">正在加载资金与偏好配置…</p></main>;
  }

  const updateAmount = (key: AmountKey, value: string) => setForm({ ...form, amounts: { ...form.amounts, [key]: value } });
  const summary = evaluation?.summary;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <form onSubmit={submit} className="mx-auto grid max-w-5xl gap-6">
        <header className="mb-2">
          <p className="text-sm font-semibold tracking-wide text-teal-700">第一阶段配置</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">资金与偏好设置</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">金额以元输入，保存时会准确转换为整数分。分类预算适用于当前自然月。</p>
        </header>

        <Section number="1" title="资金背景">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {amountFields.map((field) => <MoneyField key={field.key} label={field.label} value={form.amounts[field.key]} onChange={(value) => updateAmount(field.key, value)} />)}
            <label className="grid gap-2 text-sm font-medium text-slate-700">生活费发放日<input className="rounded-xl border border-slate-200 px-4 py-3" type="number" min="1" max="31" value={form.allowanceDay} onChange={(event) => setForm({ ...form, allowanceDay: Number(event.target.value) })} /></label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">默认地点<input className="rounded-xl border border-slate-200 px-4 py-3" value={form.defaultLocation} onChange={(event) => setForm({ ...form, defaultLocation: event.target.value })} placeholder="例如：学校东区" /></label>
          </div>
        </Section>

        <Section number="2" title="分类预算">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {transactionCategories.map((category) => <MoneyField key={category} label={categoryLabels[category]} value={form.categoryBudgets[category]} onChange={(value) => setForm({ ...form, categoryBudgets: { ...form.categoryBudgets, [category]: value } })} />)}
          </div>
          <div className="mt-6 grid gap-3 rounded-2xl bg-slate-900 p-5 text-white sm:grid-cols-3">
            {[
              ["可变消费总预算", summary?.flexibleBudgetCents],
              ["已分配预算", summary?.allocatedBudgetCents],
              ["未分配预算", summary?.unallocatedBudgetCents],
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

        <div className="sticky bottom-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className={`text-sm ${evaluation?.valid ? "text-slate-600" : "font-medium text-red-700"}`}>{message?.text ?? (evaluation?.valid ? "配置可保存" : evaluation?.reason)}</div>
          <button disabled={!evaluation?.valid || saving} className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300">{saving ? "保存中…" : "保存配置"}</button>
        </div>
        {message && <div role="status" className={`rounded-xl border p-4 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message.text}</div>}
      </form>
    </main>
  );
}
