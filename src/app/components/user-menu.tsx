"use client";

import { useRouter } from "next/navigation";
import type { AuthUser } from "@/lib/auth";

export function UserMenu({ user }: { user: AuthUser }) {
  const router = useRouter();
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
  return <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 p-1.5 pl-3 shadow-sm backdrop-blur"><div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-teal-500 text-sm font-black text-white" aria-hidden="true">{user.displayName.slice(0, 1)}</div><div className="hidden text-right sm:block"><p className="text-sm font-bold text-slate-800">{user.displayName}</p><p className="max-w-44 truncate text-[11px] text-slate-500">{user.email}</p></div><button onClick={() => void logout()} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-700">退出</button></div>;
}
