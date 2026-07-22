"use client";

import { useRef, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { agentCapabilities } from "@/lib/agent-capabilities";
import { confirmMealDecisionResponseSchema } from "@/lib/meal-decisions";
import { mealAgentChatResponseSchema, type MealAgentMessage } from "@/lib/meal-agent-chat";
import { classifyMealInput, normalizeMealConversation, truncateMealMessage } from "@/lib/meal-input-routing";
import { mealPlanAssessmentResponseSchema, type MealPlanAssessmentResponse } from "@/lib/meal-plan-assessment";
import { parseMenuText } from "@/lib/menu-text";
import { menuMealRecommendationResponseSchema, type MenuMealRecommendationResponse } from "@/lib/menu-meal-recommendations";
import { mealRecommendationQuickTags, type DirectMealRecommendationResponse, type MealRecommendationCard, type MealRecommendationQuickTag } from "@/lib/meal-recommendations";
import { centsToYuan, yuanToCents } from "@/lib/money";

const quickTagLabels: Record<MealRecommendationQuickTag, string> = {
  SAVE_MONEY: "省一点", TRY_DIFFERENT: "换换口味", LIGHT: "清淡", SPICY: "想吃辣", STAY_NEAR: "不想走远",
};
const typeLabels = { OVERALL: "综合推荐", SAVE_MONEY: "省钱之选", TASTE: "口味匹配", NEW_OR_CONVENIENT: "新鲜或方便" } as const;
const acceptedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maxImageBytes = 6 * 1024 * 1024;
type MenuPendingConfirmation = MenuMealRecommendationResponse["pendingConfirmation"][number];

type MenuStage = "idle" | "uploading" | "recognizing" | "recommending";

class MenuRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "MenuRequestError";
  }
}

const menuStatusLabels: Record<MenuMealRecommendationResponse["status"], string> = {
  READY: "已根据菜单、预算和口味生成推荐。",
  NEEDS_PRICE_CONFIRMATION: "当前候选价格不确定，请确认实际价格后重新推荐。",
  NO_RECOMMENDATIONS: "菜单中没有通过安全条件的候选；可确认价格或调整明确的硬条件后重试。",
  NO_MENU_CONTENT: "没有识别到菜单内容，可以重拍或手动输入菜单文字。",
  INSUFFICIENT_MENU_CONTENT: "有效菜单候选不足2项，请补充更完整的菜单内容。",
};

interface PendingPurchase {
  item: MealRecommendationCard;
  runId: string;
  source: "HISTORY" | "MENU";
  idempotencyKey: string;
  actualPrice: string;
  occurredAt: string;
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function signedCentsToYuan(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${centsToYuan(Math.abs(cents))}`;
}

export function EatWhatClient() {
  const [quickTags, setQuickTags] = useState<MealRecommendationQuickTag[]>([]);
  const [recommendationCount, setRecommendationCount] = useState<number>(agentCapabilities.mealRecommendations.defaultCount);
  const [userRequest, setUserRequest] = useState("");
  const [data, setData] = useState<DirectMealRecommendationResponse | null>(null);
  const [menuData, setMenuData] = useState<MenuMealRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuStage, setMenuStage] = useState<MenuStage>("idle");
  const [error, setError] = useState("");
  const [menuRetryable, setMenuRetryable] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(null);
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [lastMenuInput, setLastMenuInput] = useState<{ image?: File; text?: string } | null>(null);
  const [menuTextOpen, setMenuTextOpen] = useState(false);
  const [menuTextInput, setMenuTextInput] = useState("");
  const [conversation, setConversation] = useState<MealAgentMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [assessment, setAssessment] = useState<MealPlanAssessmentResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggle(tag: MealRecommendationQuickTag) {
    setQuickTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  async function recommend(changeBatch = false, overrides?: { request?: string; tags?: MealRecommendationQuickTag[]; skipAgentInterpretation?: boolean; appendConversation?: boolean }) {
    setLoading(true); setError(""); setAssessment(null); setPendingPurchase(null); setPurchaseMessage("");
    try {
      const effectiveRequest = overrides?.request ?? userRequest;
      const effectiveTags = overrides?.tags ?? quickTags;
      const response = await fetch("/api/meal-recommendations/direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quickTags: effectiveTags, userRequest: effectiveRequest, maxRecommendations: recommendationCount, excludeCandidateIds: changeBatch ? (data?.recommendations.map((item) => item.candidateId) ?? []) : [], skipAgentInterpretation: overrides?.skipAgentInterpretation ?? false }) });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== "object" || payload === null) throw new Error("推荐失败");
      const next = payload as DirectMealRecommendationResponse;
      setData(next); setMenuData(null);
      if (effectiveRequest.trim() && overrides?.appendConversation !== false) setConversation((current) => {
        const messages: MealAgentMessage[] = [
          ...current,
          { role: "user", content: effectiveRequest.trim() },
          ...(next.agentResponse ? [{ role: "assistant" as const, content: `${next.agentResponse.understanding} ${next.agentResponse.response}` }] : []),
        ];
        return normalizeMealConversation(messages);
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "推荐失败"); }
    finally { setLoading(false); }
  }

  async function requestMenu(options: { image?: File; text?: string; confirmedPrices?: Record<string, number>; request?: string; tags?: MealRecommendationQuickTag[]; skipAgentInterpretation?: boolean } = {}) {
    setError(""); setAssessment(null); setMenuRetryable(false); setMenuData(null); setPendingPurchase(null); setPurchaseMessage("");
    if (options.image || options.text) setLastMenuInput({ image: options.image, text: options.text });
    const body = new FormData();
    if (options.image) body.append("image", options.image);
    if (options.text) body.append("menuText", options.text);
    body.append("quickTags", JSON.stringify(options.tags ?? quickTags));
    body.append("userRequest", options.request ?? userRequest);
    body.append("maxRecommendations", String(recommendationCount));
    if (options.skipAgentInterpretation) body.append("skipAgentInterpretation", "true");
    if (options.confirmedPrices) body.append("confirmedPrices", JSON.stringify(options.confirmedPrices));
    setMenuStage(options.image ? "uploading" : "recognizing");
    await Promise.resolve();
    setMenuStage(options.confirmedPrices ? "recommending" : "recognizing");
    try {
      const response = await fetch("/api/meal-recommendations/menu", { method: "POST", body });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload
          && typeof payload.error === "object" && payload.error !== null && "message" in payload.error
          ? String(payload.error.message)
          : "菜单识别失败";
        const retryable = typeof payload === "object" && payload !== null && "retryable" in payload && payload.retryable === true;
        throw new MenuRequestError(message, retryable);
      }
      setMenuData(menuMealRecommendationResponseSchema.parse(payload));
      setData(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "菜单识别失败");
      setMenuRetryable(caught instanceof MenuRequestError && caught.retryable);
    }
    finally { setMenuStage("idle"); }
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(acceptedTypes as readonly string[]).includes(file.type)) { setError("仅支持 JPG、PNG 或 WebP 图片"); return; }
    if (file.size > maxImageBytes) { setError("图片不能超过 6MB"); return; }
    void requestMenu({ image: file });
  }

  function confirmPrice(item: MenuPendingConfirmation) {
    const value = Number(priceInputs[item.temporaryId]);
    if (!Number.isFinite(value) || value <= 0) { setError("请输入有效的实际价格"); return; }
    const confirmedPrices = Object.fromEntries(Object.entries(priceInputs).flatMap(([id, price]) => {
      const yuan = Number(price);
      return Number.isFinite(yuan) && yuan > 0 ? [[id, Math.round(yuan * 100)]] : [];
    }));
    void requestMenu({ ...lastMenuInput, confirmedPrices: { ...confirmedPrices, [item.temporaryId]: Math.round(value * 100) } });
  }

  function inputMenuText() {
    setError("");
    setMenuTextOpen(true);
  }

  function submitMenuText() {
    const text = menuTextInput.trim();
    if (parseMenuText(text).length < 2) {
      setError("请输入至少两项菜单内容，例如每行一个菜名和价格");
      return;
    }
    setMenuTextOpen(false);
    void requestMenu({ text });
  }

  function selectRecommendation(item: MealRecommendationCard, runId: string, source: "HISTORY" | "MENU") {
    setError("");
    setPurchaseMessage("");
    setPendingPurchase({
      item,
      runId,
      source,
      idempotencyKey: crypto.randomUUID(),
      actualPrice: centsToYuan(item.priceCents),
      occurredAt: localDateTimeValue(),
    });
  }

  function currentRecommendations() {
    return menuData?.recommendations.length ? menuData.recommendations : data?.recommendations ?? [];
  }

  async function chatWithAgent() {
    const message = userRequest.trim();
    const recommendations = currentRecommendations();
    if (!message) return;
    setUserRequest("");
    const route = classifyMealInput(message);
    if (route === "DIRECT_RECOMMENDATION") {
      await recommend(false, { request: message }); return;
    }
    if (route === "ASSESSMENT") { await assessMealPlan(message); return; }
    setChatBusy(true); setError("");
    try {
      const response = await fetch("/api/meal-recommendations/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: normalizeMealConversation(conversation), recommendations }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("Agent 对话失败");
      const result = mealAgentChatResponseSchema.parse(payload);
      setConversation((current) => normalizeMealConversation([...current, { role: "user", content: message }, { role: "assistant", content: result.reply }]));
      if (result.needsNewRecommendation && result.suggestedRequest) {
        const tags = [...new Set([...quickTags, ...result.suggestedQuickTags])];
        setQuickTags(tags);
        if (menuData && lastMenuInput) {
          await requestMenu({ ...lastMenuInput, request: result.suggestedRequest, tags, skipAgentInterpretation: true });
        } else {
          await recommend(false, { request: result.suggestedRequest, tags, skipAgentInterpretation: true, appendConversation: false });
        }
      }
      setUserRequest("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Agent 对话失败"); }
    finally { setChatBusy(false); }
  }

  async function assessMealPlan(description: string) {
    setChatBusy(true); setError(""); setAssessment(null); setData(null); setMenuData(null);
    try {
      const response = await fetch("/api/meal-recommendations/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "object" && payload.error && "message" in payload.error ? String(payload.error.message) : "方案评价失败");
      const result = mealPlanAssessmentResponseSchema.parse(payload);
      setAssessment(result);
      setConversation((current) => normalizeMealConversation([...current, { role: "user", content: description }, { role: "assistant", content: result.reply }]));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "方案评价失败"); }
    finally { setChatBusy(false); }
  }

  function clearConversation() {
    setConversation([]); setAssessment(null); setUserRequest("");
  }

  async function confirmPurchase() {
    if (!pendingPurchase) return;
    setConfirmingPurchase(true);
    setError("");
    try {
      const actualPriceCents = yuanToCents(pendingPurchase.actualPrice);
      if (actualPriceCents <= 0) throw new Error("实际金额必须大于0");
      const occurredAt = new Date(pendingPurchase.occurredAt);
      if (!Number.isFinite(occurredAt.getTime())) throw new Error("请选择有效的消费时间");
      const response = await fetch("/api/meal-recommendations/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: pendingPurchase.idempotencyKey,
          recommendationRunId: pendingPurchase.runId,
          candidateId: pendingPurchase.item.candidateId,
          itemName: pendingPurchase.item.name,
          source: pendingPurchase.source,
          recommendationType: pendingPurchase.item.recommendationType,
          recommendationRisk: pendingPurchase.item.risk,
          recommendedPriceCents: pendingPurchase.item.priceCents,
          actualPriceCents,
          occurredAt: occurredAt.toISOString(),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload
          && typeof payload.error === "object" && payload.error !== null && "message" in payload.error
          ? String(payload.error.message)
          : "确认记账失败";
        throw new Error(message);
      }
      const confirmed = confirmMealDecisionResponseSchema.parse(payload);
      setPurchaseMessage(`已记账，总预算剩余 ${signedCentsToYuan(confirmed.budgetAfter.remainingBudgetCents)} 元`);
      setPendingPurchase(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认记账失败");
    } finally {
      setConfirmingPurchase(false);
    }
  }

  const menuLoading = menuStage !== "idle";
  return <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-5xl">
    <div className="mb-8"><HomeLink /></div><header className="text-center"><p className="page-kicker">轻量餐食决策</p><h1 className="page-heading mt-4 text-4xl sm:text-5xl">今天吃什么？</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-600">不用填表，按当前时段、默认地点和预算直接推荐。</p></header>
    <section className="mt-8 flex flex-wrap justify-center gap-2">{mealRecommendationQuickTags.map((tag) => <button key={tag} type="button" aria-pressed={quickTags.includes(tag)} onClick={() => toggle(tag)} className={`rounded-full border px-4 py-2.5 text-sm font-semibold shadow-sm transition ${quickTags.includes(tag) ? "border-orange-600 bg-gradient-to-r from-orange-600 to-amber-500 text-white shadow-orange-600/15" : "border-white bg-white/85 text-slate-600 hover:-translate-y-0.5 hover:border-orange-200 hover:text-orange-700"}`}>{quickTagLabels[tag]}</button>)}</section>
    <div className="mt-3 flex justify-center"><label className="flex items-center gap-2 text-xs text-slate-500">候选数量<select value={recommendationCount} onChange={(event) => setRecommendationCount(Number(event.target.value))} className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-slate-700">{[4, 6, 8, 10].map((count) => <option key={count} value={count}>{count} 个</option>)}</select></label></div>
    {conversation.length > 0 && <section className="mx-auto mt-4 max-w-2xl rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-violet-900">本次决策对话</p><button type="button" onClick={clearConversation} className="text-xs text-slate-500 underline">清空对话</button></div><div className="mt-3 grid gap-3">{conversation.map((message, index) => <div key={`${message.role}-${index}`} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${message.role === "user" ? "ml-auto bg-slate-900 text-white" : "bg-violet-50 text-violet-950"}`}><p className="mb-1 text-[11px] opacity-60">{message.role === "user" ? "你" : "Agent"}</p>{message.content}</div>)}</div></section>}
    <form onSubmit={(event) => { event.preventDefault(); void chatWithAgent(); }} className="mx-auto mt-4 flex max-w-2xl gap-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-sm focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100"><label className="sr-only" htmlFor="meal-agent-request">告诉推荐 Agent 你的具体需求</label><input id="meal-agent-request" value={userRequest} onChange={(event) => setUserRequest(truncateMealMessage(event.target.value))} maxLength={agentCapabilities.conversation.maximumMessageCharacters} placeholder={currentRecommendations().length || conversation.length ? "继续说，例如：31元的麻辣烫按最近消费看合适吗？" : "例如：想吃清淡的面，或评价一下总共31元的麻辣烫"} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none" /><button type="submit" disabled={loading || chatBusy} className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{chatBusy ? "思考中…" : conversation.length ? "发送" : "问 Agent"}</button></form>
    {assessment && <section className={`mx-auto mt-5 max-w-2xl rounded-2xl border p-5 ${assessment.level === "POSITIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : assessment.level === "CAUTION" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-950"}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">本次方案评价</p><h2 className="mt-1 text-xl font-bold">{assessment.title}</h2></div><span className="text-xs opacity-60">{assessment.source === "LLM" ? "DeepSeek + 本地数据" : "本地规则"}</span></div><p className="mt-4 text-sm leading-6">{assessment.reply}</p><details className="mt-4 border-t border-current/10 pt-3 text-sm"><summary className="cursor-pointer">查看评判依据</summary><div className="mt-3 grid gap-2">{assessment.reasons.map((reason) => <p key={reason}>• {reason}</p>)}</div></details></section>}
    <div className="mt-6 flex flex-wrap justify-center gap-3"><button disabled={loading} onClick={() => void recommend(false)} className="rounded-xl bg-orange-700 px-6 py-3 font-semibold text-white disabled:bg-slate-300">{loading ? "正在推荐…" : "直接推荐"}</button>{data?.recommendations.length ? <button disabled={loading} onClick={() => void recommend(true)} className="rounded-xl border border-orange-700 bg-white px-6 py-3 font-semibold text-orange-700 disabled:opacity-50">换一批</button> : null}<button disabled={menuLoading} onClick={() => fileInputRef.current?.click()} className="rounded-xl border border-slate-800 bg-white px-6 py-3 font-semibold disabled:opacity-50">拍菜单 / 上传图片</button><input ref={fileInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleFile} /></div>
    {error && <div role="alert" className="mx-auto mt-6 max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><div className="mt-3 flex flex-wrap gap-3">{lastMenuInput && menuRetryable && <button type="button" disabled={menuLoading} onClick={() => void requestMenu(lastMenuInput)} className="font-semibold underline">重试识别</button>}<button type="button" onClick={inputMenuText} className="font-semibold underline">手动输入菜单文字</button><button type="button" onClick={() => void recommend(false)} className="font-semibold underline">改用历史推荐</button></div></div>}
    {menuLoading && <div role="status" className="mt-6 rounded-xl bg-white p-5 text-center text-sm text-slate-500">{menuStage === "uploading" ? "正在上传菜单图片…" : menuStage === "recognizing" ? "正在识别菜单…" : "正在结合预算生成推荐…"}</div>}
    {menuData && <section className="mt-8 rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">菜单推荐</h2><span className="text-xs text-slate-500">识别来源：{menuData.recognition.source === "image" ? "菜单图片" : "菜单文字"}</span></div><p className="mt-2 text-sm text-slate-600">{menuStatusLabels[menuData.status]}</p><p className="mt-2 text-xs text-slate-500">识别 {menuData.recognition.detectedCount} 项 · 有效 {menuData.recognition.validCount} 项 · 排除 {menuData.recognition.rejectedCount} 项</p>{menuData.recognition.warnings.map((warning) => <p key={warning} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">识别提示：{warning}</p>)}{menuData.pendingConfirmation.length ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-amber-900">价格未知，暂不作为预算内首选</h3>{menuData.pendingConfirmation.map((item) => <div key={item.temporaryId} className="mt-3 flex flex-wrap items-center gap-2"><span className="min-w-28 text-sm">{item.name}</span><input aria-label={`${item.name}实际价格`} value={priceInputs[item.temporaryId] ?? ""} onChange={(event) => setPriceInputs((current) => ({ ...current, [item.temporaryId]: event.target.value }))} inputMode="decimal" placeholder="实际价格" className="w-28 rounded-lg border border-amber-300 px-2 py-1" /><button type="button" onClick={() => confirmPrice(item)} disabled={menuLoading} className="rounded-lg bg-amber-700 px-3 py-1 text-sm font-semibold text-white">按实际价格重新推荐</button></div>)}</div> : null}<MenuCards recommendations={menuData.recommendations} selectedId={pendingPurchase?.item.candidateId ?? null} onSelect={(item) => selectRecommendation(item, menuData.runId, "MENU")} /></section>}
    {!menuData && <div className="mt-4 text-center"><button type="button" onClick={inputMenuText} className="text-sm text-slate-500 underline">手动输入菜单文字</button><span className="mx-2 text-slate-300">·</span><button type="button" onClick={() => void recommend(false)} className="text-sm text-slate-500 underline">改用历史推荐</button></div>}
    {(!menuData || data) && <>{loading && <div role="status" className="py-16 text-center text-sm text-slate-500">正在结合预算和近期正餐生成推荐…</div>}{!loading && data?.status === "NO_RECOMMENDATIONS" && <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white py-16 text-center text-sm text-slate-500">当前没有通过启用状态、明确价格上限和严格忌口的候选餐食。</div>}{!loading && data?.recommendations.length ? <MenuCards recommendations={data.recommendations} selectedId={pendingPurchase?.item.candidateId ?? null} onSelect={(item) => selectRecommendation(item, data.runId, "HISTORY")} /> : null}{data && <p className="mt-6 text-center text-xs text-slate-400">本次计算 {data.durationMs.toFixed(2)} ms</p>}</>}
    {pendingPurchase && <section className="mx-auto mt-8 max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold text-emerald-950">确认实际消费</h2><p className="mt-2 text-sm text-emerald-900">只有点击最终确认后才会写入消费记录。</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm text-emerald-950">餐食<input value={pendingPurchase.item.name} disabled className="rounded-lg border border-emerald-200 bg-white px-3 py-2 disabled:text-slate-700" /></label><label className="grid gap-1.5 text-sm text-emerald-950">实际金额（元）<input value={pendingPurchase.actualPrice} onChange={(event) => setPendingPurchase({ ...pendingPurchase, actualPrice: event.target.value })} inputMode="decimal" className="rounded-lg border border-emerald-300 bg-white px-3 py-2" /></label><label className="grid gap-1.5 text-sm text-emerald-950 sm:col-span-2">消费时间<input type="datetime-local" value={pendingPurchase.occurredAt} onChange={(event) => setPendingPurchase({ ...pendingPurchase, occurredAt: event.target.value })} className="rounded-lg border border-emerald-300 bg-white px-3 py-2" /></label></div><div className="mt-5 flex gap-3"><button type="button" disabled={confirmingPurchase} onClick={() => void confirmPurchase()} className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50">{confirmingPurchase ? "正在记账…" : "确认购买并记账"}</button><button type="button" disabled={confirmingPurchase} onClick={() => setPendingPurchase(null)} className="rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-900">取消</button></div></section>}
    {purchaseMessage && <p role="status" className="mx-auto mt-6 max-w-xl rounded-xl bg-emerald-100 p-4 text-center text-sm font-semibold text-emerald-900">{purchaseMessage}</p>}
    {menuData?.timing && <p className="mt-5 text-center text-xs text-slate-400">处理耗时：总计 {menuData.timing.totalMs} ms · 提取 {menuData.timing.extractionMs} ms · 上下文 {menuData.timing.contextMs} ms · 排序 {menuData.timing.rankingMs} ms</p>}
  </div>{menuTextOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="menu-text-title"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><h2 id="menu-text-title" className="text-xl font-bold">输入菜单文字</h2><p className="mt-2 text-sm text-slate-600">建议每行输入一个菜品和明确价格，例如“鸡腿饭 15元”。至少输入两项才能进行比较推荐。</p><textarea autoFocus value={menuTextInput} onChange={(event) => setMenuTextInput(event.target.value)} placeholder={"鸡腿饭 15元\n牛肉面 18元\n番茄鸡蛋面 12元"} className="mt-5 min-h-48 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100" /><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setMenuTextOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">取消</button><button type="button" onClick={submitMenuText} className="rounded-xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white">开始识别并推荐</button></div></div></div>}</main>;
}

function MenuCards({ recommendations, selectedId, onSelect }: { recommendations: MealRecommendationCard[]; selectedId: string | null; onSelect: (item: MealRecommendationCard) => void }) {
  return <section className="mt-5 grid gap-4 md:grid-cols-2">{recommendations.map((item) => <article key={item.candidateId} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold text-orange-700">{typeLabels[item.recommendationType]}</p><h2 className="mt-1 text-xl font-bold">{item.name}</h2><p className="mt-1 text-xs text-slate-500">{item.acquisitionLabel} · {item.merchant}</p></div><strong className="text-xl text-orange-700">¥{centsToYuan(item.priceCents)}</strong></div><div className="mt-4 flex flex-wrap gap-2">{item.shortTags.map((tag) => <span key={tag} className="rounded-full bg-orange-50 px-2.5 py-1 text-xs text-orange-800">{tag}</span>)}</div><p className={`mt-4 text-sm ${item.risk.includes("超") ? "font-semibold text-red-700" : "text-slate-600"}`}>风险：{item.risk}</p><button onClick={() => onSelect(item)} className="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{item.actionLabel}</button>{selectedId === item.candidateId && <p role="status" className="mt-3 text-sm text-emerald-700">已选择，等待最终确认</p>}<details className="mt-5 border-t border-stone-100 pt-4 text-sm"><summary className="cursor-pointer text-slate-600">查看详情</summary><div className="mt-3 grid gap-2 text-slate-600"><p>总分：{item.details.totalScore} / 10000</p><p>分项：预算 {item.details.scoreBreakdown.budgetFit} · 口味 {item.details.scoreBreakdown.preferenceMatch} · 多样 {item.details.scoreBreakdown.recentVariety} · 评分 {item.details.scoreBreakdown.historicalRating} · 便利 {item.details.scoreBreakdown.locationConvenience}</p>{item.details.budgetImpact ? <div className="grid gap-1 rounded-xl bg-stone-50 p-3"><p className={item.details.budgetImpact.remainingBudgetAfterCents < 0 ? "font-semibold text-red-700" : "text-slate-700"}>选择后总剩余预算：{signedCentsToYuan(item.details.budgetImpact.remainingBudgetAfterCents)} 元</p><p>后续建议日预算：¥{centsToYuan(item.details.budgetImpact.recommendedDailyBudgetAfterCents)}</p></div> : <p>预算影响：暂不可用</p>}<p>执行步骤：{item.details.executionSteps.map((step) => `${step.step}(${step.status})`).join(" → ")}</p></div></details></article>)}</section>;
}
