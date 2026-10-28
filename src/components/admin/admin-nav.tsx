"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Summary" },
  { href: "/admin/monthly", label: "Monthly" },
  { href: "/admin/data", label: "All data" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/security", label: "My security" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label="Admin sections">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path === t.href ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            path === t.href ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
