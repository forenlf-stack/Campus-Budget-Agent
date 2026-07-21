"use client";

import { Fragment, useEffect, useState } from "react";

import { HomeLink } from "@/app/components/home-link";
import { transactionCategories, type TransactionCategory } from "@/lib/budget";
import { centsToYuan, yuanToCents } from "@/lib/money";
import { categoryLabels } from "@/lib/settings";
import { transactionImportPreviewSchema, type ImportedTransactionCandidate, type TransactionImportPreview } from "@/lib/transaction-imports";
import type { AccountRecord } from "@/app/transactions/ledger-tools-panel";

function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload !== "object" || !payload || !("error" in payload)) return fallback;
  const error = payload.error;
  return typeof error === "object" && error && "message" in error ? String(error.message) : fallback;
}

const transactionTypeLabels: Record<ImportedTransactionCandidate["type"], string> = {
  EXPENSE: "支出",
  INCOME: "收入",
  REFUND: "退款",
};

const transactionTypeOrder: Record<ImportedTransactionCandidate["type"], number> = {
  EXPENSE: 0,
  INCOME: 1,
  REFUND: 2,
};

function newestFirst(left: ImportedTransactionCandidate, right: ImportedTransactionCandidate) {
  return new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
}

export function TransactionImportsClient() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TransactionImportPreview | null>(null);
  const [candidates, setCandidates] = useState<ImportedTransactionCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [batchCategory, setBatchCategory] = useState<TransactionCategory | "">("");
  const [batchMerchant, setBatchMerchant] = useState("");
  const [batchFixed, setBatchFixed] = useState<"KEEP" | "YES" | "NO">("KEEP");
  const [batchAccountId, setBatchAccountId] = useState("");
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);

  useEffect(() => { void fetch("/api/accounts").then((response) => response.json()).then((payload) => setAccounts(payload.data ?? [])).catch(() => undefined); }, []);

  const reviewCandidates = candidates
    .filter((item) => item.needsReview)
    .sort((left, right) => transactionTypeOrder[left.type] - transactionTypeOrder[right.type] || newestFirst(left, right));
  const readyCandidates = candidates.filter((item) => !item.needsReview);
  const candidateGroups = [
    {
      key: "review",
      label: "需要复核",
      description: "以下记录集中等待确认，已按支出、收入、退款排列。",
      items: reviewCandidates,
      className: "bg-amber-100 text-amber-950",
    },
    ...(["EXPENSE", "INCOME", "REFUND"] as const).map((type) => ({
      key: type,
      label: transactionTypeLabels[type],
      description: "已识别记录，组内按时间从近到远排列。",
      items: readyCandidates.filter((item) => item.type === type).sort(newestFirst),
      className: "bg-slate-100 text-slate-900",
    })),
  ].filter((group) => group.items.length > 0);

  async function analyze() {
    if (!text.trim() && !file) {
      setError("请输入账单文字或选择一个文件");
      return;
    }
    setBusy("preview");
    setError("");
    setMessage("");
    setPreview(null);
    try {
      const body = new FormData();
      if (file) body.append("file", file);
      else body.append("text", text.trim());
      const response = await fetch("/api/transaction-imports/preview", { method: "POST", body });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "账单解析失败"));
      const data = transactionImportPreviewSchema.parse(payload);
      setPreview(data);
      setCandidates(data.candidates);
      const automaticallySelected = new Set<string>();
      for (const item of data.candidates.filter((candidate) => candidate.duplicateStatus === "NEW" && !candidate.needsReview)) {
        if (item.type === "REFUND" && !item.originalTransactionId && !item.originalCandidateTemporaryId) continue;
        if (item.originalCandidateTemporaryId) {
          const original = data.candidates.find((candidate) => candidate.temporaryId === item.originalCandidateTemporaryId);
          if (!original || original.duplicateStatus !== "NEW" || original.needsReview) continue;
          automaticallySelected.add(original.temporaryId);
        }
        automaticallySelected.add(item.temporaryId);
      }
      setSelected(automaticallySelected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账单解析失败");
    } finally {
      setBusy("");
    }
  }

  function update(id: string, patch: Partial<ImportedTransactionCandidate>) {
    setCandidates((current) => current.map((item) => item.temporaryId === id ? { ...item, ...patch } : item));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      const candidate = candidates.find((item) => item.temporaryId === id);
      if (next.has(id)) {
        next.delete(id);
        for (const refund of candidates.filter((item) => item.originalCandidateTemporaryId === id)) next.delete(refund.temporaryId);
      } else {
        next.add(id);
        if (candidate?.originalCandidateTemporaryId) next.add(candidate.originalCandidateTemporaryId);
      }
      return next;
    });
  }

  function applyBatch() {
    if (!selected.size) { setError("请先勾选要批量处理的记录"); return; }
    setCandidates((current) => current.map((item) => {
      if (!selected.has(item.temporaryId)) return item;
      const patch: Partial<ImportedTransactionCandidate> = {};
      if (batchMerchant.trim()) patch.merchant = batchMerchant.trim();
      if (batchCategory && item.type !== "INCOME" && !(item.type === "REFUND" && item.originalTransactionId)) patch.category = batchCategory;
      if (batchFixed !== "KEEP" && item.type !== "INCOME" && !(item.type === "REFUND" && item.originalTransactionId)) patch.isFixedExpense = batchFixed === "YES";
      if (batchAccountId) patch.accountId = batchAccountId;
      return { ...item, ...patch };
    }));
    setMessage(`已批量更新 ${selected.size} 条候选记录，请继续检查后再导入。`);
    setError("");
  }

  async function commit() {
    if (!preview) return;
    const transactions = candidates.filter((item) => selected.has(item.temporaryId)).map((item) => ({
      temporaryId: item.temporaryId,
      type: item.type,
      category: item.type === "INCOME" ? null : item.category,
      amountCents: item.amountCents,
      occurredAt: item.occurredAt,
      itemName: item.itemName,
      merchant: item.merchant,
      note: item.note,
      isFixedExpense: item.isFixedExpense,
      originalTransactionId: item.originalTransactionId,
      originalCandidateTemporaryId: item.originalCandidateTemporaryId,
      accountId: item.accountId ?? null,
    }));
    if (!transactions.length) {
      setError("请至少选择一条确认无误的记录");
      return;
    }
    setBusy("commit");
    setError("");
    try {
      const response = await fetch("/api/transaction-imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: preview.importId, transactions }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "导入失败"));
      setMessage(`已导入 ${transactions.length} 条交易记录。`);
      setPreview(null);
      setCandidates([]);
      setSelected(new Set());
      setText("");
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setBusy("");
    }
  }

  return <main className="app-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-6xl">
    <HomeLink />
    <header className="mt-8 max-w-3xl">
      <p className="page-kicker">主动提供 · 预览确认</p>
      <h1 className="page-heading mt-4 text-4xl">导入交易记录</h1>
      <p className="mt-3 text-sm leading-7 text-slate-600">支持微信、支付宝、银行短信等文字描述，账单截图，以及 XLSX、XLS、CSV、TSV 表格。文件只在本地服务中解析；只有你最终确认的记录才会写入数据库。</p>
    </header>

    <section className="surface-card mt-8 grid gap-6 rounded-[2rem] p-6 lg:grid-cols-2">
      <div><label className="text-sm font-semibold">粘贴账单文字或银行短信</label><textarea value={text} onChange={(event) => { setText(event.target.value); if (event.target.value) setFile(null); }} placeholder={"2026-07-18 12:30 午餐 支出20元\n2026-07-18 18:10 地铁 支出3元"} className="mt-3 min-h-52 w-full rounded-2xl border border-slate-200 p-4 text-sm outline-none focus:border-cyan-600" /></div>
      <div><p className="text-sm font-semibold">上传账单截图或表格</p><label className="mt-3 grid min-h-52 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-stone-50 p-6 text-center hover:border-cyan-500"><input type="file" hidden accept="image/jpeg,image/png,image/webp,.xlsx,.xls,.csv,.tsv" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setText(""); }} /><span><strong className="block text-cyan-800">选择文件</strong><span className="mt-2 block text-xs text-slate-500">JPG / PNG / WebP / XLSX / XLS / CSV / TSV，最大 12MB</span>{file && <span className="mt-3 block text-sm font-semibold text-slate-800">{file.name}</span>}</span></label></div>
      <button onClick={() => void analyze()} disabled={Boolean(busy)} className="rounded-xl bg-cyan-800 px-5 py-3 font-semibold text-white disabled:opacity-50 lg:col-span-2">{busy === "preview" ? "正在解析并检查重复…" : "生成导入预览"}</button>
    </section>

    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}

    {preview && <>
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">识别候选</p><p className="mt-1 text-2xl font-bold">{candidates.length}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">可能重复</p><p className="mt-1 text-2xl font-bold">{candidates.filter((item) => item.duplicateStatus === "POSSIBLE_DUPLICATE").length}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">需要复核</p><p className="mt-1 text-2xl font-bold">{candidates.filter((item) => item.needsReview).length}</p></div>
      </section>
      {preview.warnings.map((warning) => <p key={warning} className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}

      <section className="surface-card mt-6 overflow-hidden rounded-3xl"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3"><div><h2 className="font-bold text-slate-900">按状态聚合的候选记录</h2><p className="mt-1 text-xs text-slate-500">需复核记录优先集中展示，确认后再统一导入。</p></div><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">表格可横向滑动 →</span></div>
      <div className="border-b border-slate-100 bg-indigo-50/60 p-4"><div className="flex flex-wrap items-end gap-3"><div><p className="text-xs font-black text-indigo-950">批量操作 · 已选 {selected.size} 条</p><p className="mt-1 text-xs text-indigo-700">留空的字段不会被修改。</p></div><label className="grid gap-1 text-xs font-semibold text-slate-600">统一分类<select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value as TransactionCategory | "")} className="rounded-lg border border-slate-200 bg-white px-2 py-2"><option value="">保持原分类</option>{transactionCategories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">统一商家<input value={batchMerchant} onChange={(event) => setBatchMerchant(event.target.value)} placeholder="留空不修改" className="rounded-lg border border-slate-200 bg-white px-2 py-2" /></label><label className="grid gap-1 text-xs font-semibold text-slate-600">资金账户<select value={batchAccountId} onChange={(event) => setBatchAccountId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2"><option value="">保持原账户</option>{accounts.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-slate-600">固定支出<select value={batchFixed} onChange={(event) => setBatchFixed(event.target.value as typeof batchFixed)} className="rounded-lg border border-slate-200 bg-white px-2 py-2"><option value="KEEP">保持原设置</option><option value="YES">设为固定支出</option><option value="NO">设为非固定支出</option></select></label><button type="button" onClick={applyBatch} className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white">应用到已选记录</button></div></div>
      <div className="data-scroll overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm">
        <thead className="bg-slate-900 text-white"><tr><th className="p-3">导入</th><th className="p-3">类型</th><th className="p-3">时间</th><th className="p-3">金额</th><th className="p-3">项目</th><th className="p-3">商家</th><th className="p-3">分类</th><th className="p-3">状态</th></tr></thead>
        <tbody>{candidateGroups.map((group) => <Fragment key={group.key}>
          <tr className={group.className}><th colSpan={8} scope="rowgroup" className="px-4 py-3 text-left"><span className="font-bold">{group.label} · {group.items.length} 条</span><span className="ml-3 text-xs font-normal opacity-75">{group.description}</span></th></tr>
          {group.items.map((item) => {
            const refundBlocked = item.type === "REFUND" && !item.originalTransactionId && !item.originalCandidateTemporaryId;
            return <tr key={item.temporaryId} className="border-t border-stone-100 align-top">
              <td className="p-3"><input type="checkbox" checked={selected.has(item.temporaryId)} disabled={refundBlocked} onChange={() => toggle(item.temporaryId)} aria-label={`导入${item.itemName}`} /></td>
              <td className="p-3"><select value={item.type} onChange={(event) => { const nextType = event.target.value as ImportedTransactionCandidate["type"]; update(item.temporaryId, { type: nextType, category: nextType === "INCOME" ? null : item.category, originalTransactionId: null, originalCandidateTemporaryId: null }); }} className="rounded-lg border px-2 py-1"><option value="EXPENSE">支出</option><option value="INCOME">收入</option><option value="REFUND">退款</option></select></td>
              <td className="p-3"><input type="datetime-local" value={localDateTime(item.occurredAt)} onChange={(event) => update(item.temporaryId, { occurredAt: new Date(event.target.value).toISOString() })} className="rounded-lg border px-2 py-1" /></td>
              <td className="p-3"><input value={centsToYuan(item.amountCents)} onChange={(event) => { try { update(item.temporaryId, { amountCents: yuanToCents(event.target.value) }); } catch { /* 保留上一次合法金额。 */ } }} className="w-24 rounded-lg border px-2 py-1" /></td>
              <td className="p-3"><input value={item.itemName} onChange={(event) => update(item.temporaryId, { itemName: event.target.value })} className="w-44 rounded-lg border px-2 py-1" /></td>
              <td className="p-3"><input value={item.merchant} onChange={(event) => update(item.temporaryId, { merchant: event.target.value })} className="w-36 rounded-lg border px-2 py-1" /></td>
              <td className="p-3"><select value={item.category ?? ""} disabled={item.type === "INCOME"} onChange={(event) => update(item.temporaryId, { category: event.target.value as TransactionCategory, ...(item.type === "REFUND" ? { originalTransactionId: null, originalCandidateTemporaryId: null } : {}) })} className="rounded-lg border px-2 py-1"><option value="">请选择</option>{transactionCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></td>
              <td className="p-3"><div className="grid gap-1 text-xs">{item.duplicateStatus === "POSSIBLE_DUPLICATE" && <span className="font-semibold text-red-700">可能重复</span>}{item.needsReview && <span className="font-semibold text-amber-700">需复核</span>}{item.originalCandidateTemporaryId && <span className="font-semibold text-emerald-700">已关联本次导入的原支出</span>}{item.originalTransactionId && <span className="font-semibold text-emerald-700">已关联账本中的原支出</span>}{refundBlocked && <span className="text-red-700">尚未找到可信的原支出</span>}{item.reviewReasons.map((reason) => <span key={reason} className="text-slate-500">{reason}</span>)}</div></td>
            </tr>;
          })}
        </Fragment>)}</tbody>
      </table></div></section>

      <section className="mt-6 rounded-2xl border border-cyan-100 bg-cyan-50 p-5"><h2 className="font-bold text-cyan-950">导入数据画像预览</h2><p className="mt-2 text-xs text-cyan-800">这些信号只来自本次候选，用于辅助后续分析，不会自动修改你的偏好设置。</p><div className="mt-4 flex flex-wrap gap-2">{preview.profileSignals.frequentMerchants.slice(0, 5).map((item) => <span key={item.merchant} className="rounded-full bg-white px-3 py-1.5 text-xs text-cyan-900">常见商家：{item.merchant} × {item.count}</span>)}{preview.profileSignals.frequentCategories.slice(0, 5).map((item) => <span key={item.category} className="rounded-full bg-white px-3 py-1.5 text-xs text-cyan-900">{categoryLabels[item.category]} {item.count} 笔</span>)}</div></section>
      <button onClick={() => void commit()} disabled={Boolean(busy) || selected.size === 0} className="mt-6 w-full rounded-2xl bg-gradient-to-r from-slate-950 to-indigo-950 px-5 py-3.5 font-bold text-white shadow-lg shadow-indigo-950/10 hover:-translate-y-0.5 disabled:opacity-40">{busy === "commit" ? "正在写入数据库…" : `确认导入已选择的 ${selected.size} 条记录`}</button>
    </>}
  </div></main>;
}
