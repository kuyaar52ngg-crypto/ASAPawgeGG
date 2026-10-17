"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  /** match only the exact path (default: prefix match) */
  exact?: boolean;
}

/**
 * Shared sidebar shell for cabinets (/account, /seller, /admin).
 * Usage in a layout:  <DashboardShell title="Кабинет продавца" nav={[{href:"/seller", label:"Обзор", exact:true}, ...]}>{children}</DashboardShell>
 */
export function DashboardShell({ title, nav, children }: { title: string; nav: NavItem[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (i: NavItem) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/"));
  return (
    <div className="container-page grid gap-6 py-6 lg:grid-cols-[250px_1fr] lg:py-8">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 px-3 font-display text-sm font-semibold text-muted-foreground">{title}</p>
        <nav className="no-scrollbar glass flex gap-1 overflow-x-auto rounded-2xl p-2 lg:flex-col lg:overflow-visible">
          {nav.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
                isActive(i) ? "bg-primary/15 text-foreground [&_svg]:text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {i.icon}
              {i.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
