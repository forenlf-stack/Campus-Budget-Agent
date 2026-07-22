import Link from "next/link";

export function HomeLink({ href = "/", label = "返回主页" }: { href?: string; label?: string }) {
  return <Link href={href} className="group inline-flex items-center gap-2 rounded-2xl border border-white/90 bg-white/80 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.07)] backdrop-blur transition hover:-translate-y-0.5 hover:border-orange-200 hover:text-orange-700 hover:shadow-[0_12px_28px_rgba(234,88,12,0.10)]"><span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">←</span> {label}</Link>;
}
