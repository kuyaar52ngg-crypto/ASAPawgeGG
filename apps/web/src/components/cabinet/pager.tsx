import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Simple server-rendered pager. `hrefFor(page)` builds the link for a page number. */
export function Pager({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Страницы">
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

/** Pill-style filter links (status tabs etc). */
export function FilterPills({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors " +
            (i.key === active ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground")
          }
        >
          {i.label}
          {typeof i.count === "number" && <span className="ml-1.5 text-xs text-muted-foreground">{i.count}</span>}
        </Link>
      ))}
    </div>
  );
}
