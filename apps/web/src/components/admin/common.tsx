import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Build `/path?a=1&b=2`, skipping empty values. */
export function href(path: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && String(v) !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export function Pager({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Страницы">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm"><Link href={hrefFor(page - 1)}><ChevronLeft /> Назад</Link></Button>
      ) : (
        <Button variant="outline" size="sm" disabled><ChevronLeft /> Назад</Button>
      )}
      <span className="text-sm text-muted-foreground">{page} из {pageCount}</span>
      {page < pageCount ? (
        <Button asChild variant="outline" size="sm"><Link href={hrefFor(page + 1)}>Вперёд <ChevronRight /></Link></Button>
      ) : (
        <Button variant="outline" size="sm" disabled>Вперёд <ChevronRight /></Button>
      )}
    </nav>
  );
}

/** Pill-style filter links (status tabs, period switcher). */
export function FilterPills({ items, active, className }: { items: { href: string; label: string; key: string; count?: number }[]; active: string; className?: string }) {
  return (
    <div className={cn("no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1", className)}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            i.key === active ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          {i.label}
          {typeof i.count === "number" && <span className="ml-1.5 text-xs text-muted-foreground">{i.count}</span>}
        </Link>
      ))}
    </div>
  );
}

/** GET search form that keeps the other query params (pass them as `hidden`). */
export function SearchForm({ action, q, placeholder = "Поиск…", hidden = {}, children }: { action: string; q: string; placeholder?: string; hidden?: Record<string, string | undefined>; children?: React.ReactNode }) {
  return (
    <form action={action} method="get" className="mb-5 flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-56 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder={placeholder} className="pl-10" />
      </div>
      {children}
      <Button type="submit" variant="secondary">Найти</Button>
    </form>
  );
}

export function StatTile({ label, value, hint, icon, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: "default" | "success" | "warning" | "destructive" }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn("flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary [&_svg]:size-[18px]", tone === "success" && "bg-success/15 text-success", tone === "warning" && "bg-warning/15 text-warning", tone === "destructive" && "bg-destructive/15 text-destructive")}>{icon}</span>
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Definition list used on detail pages. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className={cn("max-h-72 overflow-auto rounded-xl bg-foreground/[0.05] p-3 text-xs leading-relaxed whitespace-pre-wrap break-words", className)}>{JSON.stringify(value, null, 2)}</pre>;
}

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

export function StatusBadge({ value, labels, variants }: { value: string; labels: Record<string, string>; variants: Record<string, BadgeVariant> }) {
  return <Badge variant={variants[value] ?? "outline"}>{labels[value] ?? value}</Badge>;
}
