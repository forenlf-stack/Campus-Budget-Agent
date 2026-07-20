"use client";

import { useEffect, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { modelSettingsPublicSchema, type ModelSettingsPublic } from "@/lib/model-settings";

interface FormState {
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKey: string;
  glmBaseUrl: string;
  glmOcrModel: string;
  glmApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
  visionApiKey: string;
}

type Provider = "deepseek" | "glm" | "vision";

export function ModelSettingsClient() {
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<ModelSettingsPublic | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void fetch("/api/model-settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        const data = modelSettingsPublicSchema.parse(payload.data);
        setStatus(data);
        setForm({
          deepseekBaseUrl: data.deepseekBaseUrl,
          deepseekModel: data.deepseekModel,
          deepseekApiKey: "",
          glmBaseUrl: data.glmBaseUrl,
          glmOcrModel: data.glmOcrModel,
          glmApiKey: "",
          visionBaseUrl: data.visionBaseUrl,
          visionModel: data.visionModel,
          visionApiKey: "",
        });
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "加载模型配置失败"));
  }, []);

  async function saveConfiguration(successMessage = "模型配置已保存在本机，API Key 不会返回到浏览器。") {
    if (!form) throw new Error("模型配置尚未加载");
    const response = await fetch("/api/model-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deepseekBaseUrl: form.deepseekBaseUrl,
        deepseekModel: form.deepseekModel,
        deepseekApiKey: form.deepseekApiKey || undefined,
        clearDeepseekApiKey: false,
        glmBaseUrl: form.glmBaseUrl,
        glmOcrModel: form.glmOcrModel,
        glmApiKey: form.glmApiKey || undefined,
        clearGlmApiKey: false,
        visionBaseUrl: form.visionBaseUrl,
        visionModel: form.visionModel,
        visionApiKey: form.visionApiKey || undefined,
        clearVisionApiKey: false,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "保存失败");
    const data = modelSettingsPublicSchema.parse(payload.data);
    setStatus(data);
    setForm({ ...form, deepseekApiKey: "", glmApiKey: "", visionApiKey: "" });
    setMessage(successMessage);
  }

  async function save() {
    if (!form) return;
    setBusy("save"); setError(""); setMessage("");
    try { await saveConfiguration(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(""); }
  }

  async function test(provider: Provider) {
    setBusy(provider); setError(""); setMessage("");
    try {
      await saveConfiguration("配置已保存，正在测试连接…");
      const response = await fetch("/api/model-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "测试失败");
      setMessage(payload.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "测试失败"); }
    finally { setBusy(""); }
  }

  if (!form) return <main className="app-page p-8"><HomeLink /><p className="mt-16 text-center text-sm text-slate-500">正在加载模型配置…</p></main>;

  const statusBadge = (configured: boolean) => <span className={`rounded-full px-3 py-1 text-xs ${configured ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{configured ? "已配置" : "未配置"}</span>;

  return <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-5xl">
    <HomeLink />
    <header className="mt-8 max-w-3xl"><p className="page-kicker">本地服务端配置</p><h1 className="page-heading mt-4 text-4xl">模型与菜单识别</h1><p className="mt-3 text-sm leading-7 text-slate-600">多模态模型直接读取菜单原图；DeepSeek 负责理解自然语言需求。预算计算、忌口过滤与记账仍由本地代码控制。</p></header>
    <section className="mt-8 rounded-[2rem] border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-6 shadow-[0_12px_38px_rgba(14,165,233,0.08)]">
      <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-700">推荐主流程</p><h2 className="mt-1 text-xl font-bold">OpenAI 兼容多模态菜单模型</h2></div>{statusBadge(Boolean(status?.visionConfigured))}</div>
      <p className="mt-3 text-sm text-slate-600">直接把原图发送至兼容的 <code>/v1/chat/completions</code> 接口，避免 OCR 拆散商品名和价格的空间关系。</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm">Base URL<input value={form.visionBaseUrl} onChange={(event) => setForm({ ...form, visionBaseUrl: event.target.value })} className="rounded-xl border bg-white px-3 py-2" /></label><label className="grid gap-2 text-sm">模型<input value={form.visionModel} onChange={(event) => setForm({ ...form, visionModel: event.target.value })} className="rounded-xl border bg-white px-3 py-2" /></label></div>
      <label className="mt-4 grid gap-2 text-sm">API Key<input type="password" autoComplete="new-password" value={form.visionApiKey} onChange={(event) => setForm({ ...form, visionApiKey: event.target.value })} placeholder={status?.visionConfigured ? "已保存；留空保持不变" : "输入 Codex 分组 API Key"} className="rounded-xl border bg-white px-3 py-2" /></label>
      <button onClick={() => void test("vision")} disabled={Boolean(busy)} className="mt-5 rounded-xl bg-sky-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "vision" ? "测试中…" : "测试多模态模型"}</button>
    </section>
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">DeepSeek 需求理解</h2>{statusBadge(Boolean(status?.deepseekConfigured))}</div><label className="mt-5 grid gap-2 text-sm">Base URL<input value={form.deepseekBaseUrl} onChange={(event) => setForm({ ...form, deepseekBaseUrl: event.target.value })} className="rounded-xl border px-3 py-2" /></label><label className="mt-4 grid gap-2 text-sm">模型<input value={form.deepseekModel} onChange={(event) => setForm({ ...form, deepseekModel: event.target.value })} className="rounded-xl border px-3 py-2" /></label><label className="mt-4 grid gap-2 text-sm">API Key<input type="password" autoComplete="new-password" value={form.deepseekApiKey} onChange={(event) => setForm({ ...form, deepseekApiKey: event.target.value })} placeholder={status?.deepseekConfigured ? "已保存；留空保持不变" : "输入 API Key"} className="rounded-xl border px-3 py-2" /></label><button onClick={() => void test("deepseek")} disabled={Boolean(busy)} className="mt-5 rounded-xl border border-violet-700 px-4 py-2 text-sm font-semibold text-violet-800 disabled:opacity-50">{busy === "deepseek" ? "测试中…" : "测试 DeepSeek"}</button></section>
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">GLM OCR 备用</h2><p className="mt-1 text-xs text-slate-500">不再作为图片识别主流程</p></div>{statusBadge(Boolean(status?.glmConfigured))}</div><label className="mt-5 grid gap-2 text-sm">Base URL<input value={form.glmBaseUrl} onChange={(event) => setForm({ ...form, glmBaseUrl: event.target.value })} className="rounded-xl border px-3 py-2" /></label><label className="mt-4 grid gap-2 text-sm">OCR 工具类型<input value={form.glmOcrModel} onChange={(event) => setForm({ ...form, glmOcrModel: event.target.value })} className="rounded-xl border px-3 py-2" /></label><label className="mt-4 grid gap-2 text-sm">API Key<input type="password" autoComplete="new-password" value={form.glmApiKey} onChange={(event) => setForm({ ...form, glmApiKey: event.target.value })} placeholder={status?.glmConfigured ? "已保存；留空保持不变" : "输入 API Key"} className="rounded-xl border px-3 py-2" /></label><button onClick={() => void test("glm")} disabled={Boolean(busy)} className="mt-5 rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50">{busy === "glm" ? "检查中…" : "检查 GLM 配置"}</button></section>
    </div>
    <button onClick={() => void save()} disabled={Boolean(busy)} className="mt-6 w-full rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white disabled:bg-slate-300">{busy === "save" ? "正在保存…" : "保存模型配置"}</button>
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <p className="mt-5 text-xs text-slate-500">密钥保存在项目根目录的忽略文件中，仅由服务端读取，不会返回给浏览器。</p>
  </div></main>;
}
