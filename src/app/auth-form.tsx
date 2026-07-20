"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = mode === "register"
      ? { displayName: form.get("displayName"), email: form.get("email"), password: form.get("password") }
      : { email: form.get("email"), password: form.get("password") };
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || (mode === "login" ? "登录失败" : "注册失败"));
      router.replace("/"); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
    finally { setBusy(false); }
  }

  const inputClass = "rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3.5 text-slate-900 placeholder:text-slate-400";
  return <form onSubmit={submit} className="mt-8 grid gap-5">
    {mode === "register" && <label className="grid gap-2 text-sm font-semibold text-slate-700">昵称<input name="displayName" autoComplete="name" required minLength={2} maxLength={40} className={inputClass} placeholder="例如：小林" /></label>}
    <label className="grid gap-2 text-sm font-semibold text-slate-700">邮箱<input name="email" type="email" autoComplete="email" required className={inputClass} placeholder="name@example.com" /></label>
    <label className="grid gap-2 text-sm font-semibold text-slate-700">密码<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} className={inputClass} placeholder={mode === "register" ? "至少8位，包含字母和数字" : "输入密码"} /></label>
    {error && <p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><span className="mr-2" aria-hidden="true">!</span>{error}</p>}
    <button disabled={busy} className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-950 to-indigo-950 px-5 py-3.5 font-bold text-white shadow-lg shadow-indigo-950/15 hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-60">{busy ? "请稍候…" : mode === "login" ? "登录账户" : "创建账户"}<span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></button>
    <p className="text-center text-sm text-slate-500">{mode === "login" ? "还没有账户？" : "已经有账户？"}<Link className="ml-1 font-bold text-indigo-700 hover:underline" href={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "立即注册" : "返回登录"}</Link></p>
  </form>;
}
