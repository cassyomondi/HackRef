"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

const destinations: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/submissions", label: "Submissions", icon: "file" },
  { href: "/judging", label: "Judging", icon: "scale" },
  { href: "/analytics", label: "Analytics", icon: "chart" },
  { href: "/awards", label: "Awards", icon: "trophy" },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main navigation"
      className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:gap-2 lg:px-5 lg:py-0"
    >
      {destinations.map(({ href, label, icon }) => {
        const active =
          href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-teal-50 text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            <Icon
              name={icon}
              className={active ? "text-teal-700" : "text-slate-400"}
            />
            {label}
            {active && (
              <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-teal-600 lg:block" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
