"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { AccountProfile } from "@/lib/profile";

const managementLinks = [
  { href: "/settings/preferences", icon: "预", title: "预算与偏好", description: "管理总预算、资金背景、地点、口味与忌口", tone: "from-emerald-600 to-teal-400" },
  { href: "/meal-candidates", icon: "餐", title: "餐食候选", description: "维护吃过或愿意选择的餐食与价格", tone: "from-orange-500 to-amber-400" },
  { href: "/settings/models", icon: "模", title: "模型设置", description: "配置 DeepSeek 模型、地址与连接状态", tone: "from-violet-600 to-fuchsia-400" },
] as const;

async function responseMessage(response: Response) {
  const body = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "操作失败，请稍后重试");
  return body;
}

export function ProfileClient({ initialProfile }: { initialProfile: AccountProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setProfileMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: profile.displayName, email: profile.email, phone: profile.phone }) });
      const body = await responseMessage(response) as { data?: AccountProfile };
      if (body.data) setProfile(body.data);
      setProfileMessage("账户资料已保存"); router.refresh();
    } catch (error) { setProfileMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setChangingPassword(true); setPasswordMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/profile/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword"), confirmPassword: data.get("confirmPassword") }) });
      await responseMessage(response); form.reset(); setPasswordMessage("密码已修改，下次登录请使用新密码");
    } catch (error) { setPasswordMessage(error instanceof Error ? error.message : "修改失败"); }
    finally { setChangingPassword(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login"); router.refresh();
  }

  return <main className="app-page profile-page px-4 py-8 text-slate-900 sm:px-6 sm:py-10"><div className="relative mx-auto max-w-6xl">
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="page-kicker">个人空间</p><h1 className="page-heading mt-5 text-4xl sm:text-5xl">用户信息与设置</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">账户资料、偏好、餐食候选和模型配置统一从这里管理。</p></div><Link href="/" className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:border-orange-200 hover:text-orange-700">返回主页</Link></header>

    <section className="mt-9 grid gap-4 md:grid-cols-3" aria-label="个性化管理入口">{managementLinks.map((item) => <Link key={item.href} href={item.href} className="group surface-card rounded-[1.75rem] p-5 hover:-translate-y-1"><div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${item.tone} font-black text-white`}>{item.icon}</div><h2 className="mt-5 flex items-center justify-between text-lg font-black"><span>{item.title}</span><span className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-orange-600">→</span></h2><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p></Link>)}</section>

    <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <form onSubmit={saveProfile} className="surface-card rounded-[2rem] p-6 sm:p-8"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-400 text-xl font-black text-white">{profile.displayName.slice(0, 1) || "用"}</div><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">Account</p><h2 className="mt-1 text-2xl font-black">账号资料</h2></div></div>
        <div className="mt-7 grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-slate-700">昵称<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" required minLength={2} maxLength={40} /></label><label className="grid gap-2 text-sm font-bold text-slate-700">关联邮箱<input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" required maxLength={160} /></label><label className="grid gap-2 text-sm font-bold text-slate-700 sm:col-span-2">关联手机 <span className="font-normal text-slate-400">仅保存联系方式，不发送验证码</span><input type="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="例如：138 0000 0000" className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" maxLength={30} /></label></div>
        <div className="mt-6 flex flex-wrap items-center gap-3"><button disabled={saving} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50">{saving ? "正在保存…" : "保存账号资料"}</button>{profileMessage && <p role="status" className={`text-sm ${profileMessage.includes("已保存") ? "text-emerald-700" : "text-red-700"}`}>{profileMessage}</p>}</div>
      </form>

      <form onSubmit={changePassword} className="surface-card rounded-[2rem] p-6 sm:p-8"><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">Security</p><h2 className="mt-1 text-2xl font-black">修改密码</h2><p className="mt-2 text-sm leading-6 text-slate-500">新密码至少 8 位，并同时包含字母和数字。</p><div className="mt-6 grid gap-4"><label className="grid gap-2 text-sm font-bold text-slate-700">当前密码<input name="currentPassword" type="password" autoComplete="current-password" className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" required /></label><label className="grid gap-2 text-sm font-bold text-slate-700">新密码<input name="newPassword" type="password" autoComplete="new-password" className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" required minLength={8} /></label><label className="grid gap-2 text-sm font-bold text-slate-700">确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" className="rounded-2xl border border-stone-200 bg-white px-4 py-3 font-normal" required minLength={8} /></label></div><button disabled={changingPassword} className="mt-5 w-full rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50">{changingPassword ? "正在修改…" : "确认修改密码"}</button>{passwordMessage && <p role="status" className={`mt-3 text-sm ${passwordMessage.includes("已修改") ? "text-emerald-700" : "text-red-700"}`}>{passwordMessage}</p>}
      </form>
    </div>

    <section className="surface-card mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] p-5"><div><h2 className="font-black">退出当前账号</h2><p className="mt-1 text-sm text-slate-500">退出不会删除账户中的预算、账单和候选数据。</p></div><button onClick={() => void logout()} className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700 hover:bg-red-100">退出账号</button></section>
  </div></main>;
}
