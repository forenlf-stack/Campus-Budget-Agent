"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "主页", icon: "⌂" },
  { href: "/profile", label: "用户信息", icon: "人" },
] as const;

export function BottomNavigation() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/register") return null;
  return <nav className="bottom-navigation" aria-label="主要导航">
    <div className="bottom-navigation__inner">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href) || pathname.startsWith("/settings") || pathname === "/meal-candidates";
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`bottom-navigation__item ${active ? "is-active" : ""}`}>
          <span className="bottom-navigation__icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </Link>;
      })}
    </div>
  </nav>;
}
