import Link from "next/link";
import type { AuthUser } from "@/lib/auth";

export function UserMenu({ user }: { user: AuthUser }) {
  return <Link href="/profile" className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/75 p-1.5 pl-3 shadow-sm backdrop-blur hover:border-amber-200 hover:bg-white" aria-label="打开用户信息"><div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-400 text-sm font-black text-white" aria-hidden="true">{user.displayName.slice(0, 1)}</div><div className="hidden text-right sm:block"><p className="text-sm font-bold text-slate-800">{user.displayName}</p><p className="max-w-44 truncate text-[11px] text-slate-500">用户信息</p></div><span className="pr-2 text-slate-400" aria-hidden="true">›</span></Link>;
}
